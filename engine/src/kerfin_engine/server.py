"""Local HTTP API used by the desktop UI.

Security model:
- listens on 127.0.0.1 only, on a port chosen at start;
- every request must carry the token the desktop shell generated for this launch;
- the Host header must name the loopback address (no DNS rebinding from web pages);
- responses are never cached (WebView2 would otherwise write them to disk in clear);
- the vault locks itself after a period without user activity.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import asdict
from decimal import Decimal, InvalidOperation
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import metadata
from pathlib import Path
from typing import Any

from kerfin_engine import institutions, paths
from kerfin_engine.connectors import registry
from kerfin_engine.connectors.base import ConnectorError
from kerfin_engine.domain import AccountKind
from kerfin_engine.store import Store
from kerfin_engine.sync import SyncService
from kerfin_engine.vault import Vault, VaultError, WrongPassphrase

log = logging.getLogger(__name__)

TAURI_ORIGINS = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"}
DEFAULT_AUTO_LOCK_MINUTES = 15
# Environment variables that would let another program make us trust its certificates.
CA_OVERRIDES = ("REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "SSL_CERT_FILE", "SSL_CERT_DIR")


def engine_version() -> str:
    try:
        return metadata.version("kerfin-engine")
    except metadata.PackageNotFoundError:
        return "dev"


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.status, self.code, self.detail = status, code, detail


def _locked() -> ApiError:
    return ApiError(HTTPStatus.LOCKED, "vault_locked")


class App:
    """The engine's state: the vault, the unlocked store and the sync jobs."""

    def __init__(self, data_dir: Path) -> None:
        self.vault = Vault(data_dir / "kerfin.vault")
        self.store: Store | None = None
        self.sync: SyncService | None = None
        self.last_activity = time.monotonic()
        self._lock = threading.RLock()

    # Vault

    def status(self) -> dict[str, Any]:
        state = "unlocked" if self.store else ("locked" if self.vault.exists else "missing")
        return {
            "vault": state,
            "version": engine_version(),
            "auto_lock_minutes": self.auto_lock_minutes if self.store else None,
        }

    def create(self, passphrase: str) -> None:
        with self._lock:
            store = Store.create()
            try:
                self.vault.create(passphrase, store.dump())
            except VaultError as error:
                raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_passphrase", str(error)) from error
            self._open(store)

    def unlock(self, passphrase: str) -> None:
        with self._lock:
            if self.store:
                return
            if not self.vault.exists:
                raise ApiError(HTTPStatus.CONFLICT, "vault_missing")
            try:
                self._open(Store.load(self.vault.unlock(passphrase)))
            except WrongPassphrase:
                raise ApiError(HTTPStatus.UNAUTHORIZED, "wrong_passphrase") from None

    def _open(self, store: Store) -> None:
        self.store = store
        self.sync = SyncService(store, self.persist)
        self.last_activity = time.monotonic()

    def lock(self) -> None:
        with self._lock:
            if self.sync:
                self.sync.cancel_all()
            if self.store:
                self.store.close()
            self.store, self.sync = None, None
            self.vault.lock()

    def persist(self) -> None:
        with self._lock:
            if self.store:
                self.vault.save(self.store.dump())

    def unlocked(self) -> tuple[Store, SyncService]:
        if not self.store or not self.sync:
            raise _locked()
        return self.store, self.sync

    @property
    def auto_lock_minutes(self) -> int:
        return (
            int(self.store.setting("auto_lock_minutes", str(DEFAULT_AUTO_LOCK_MINUTES))) if self.store else 0
        )

    def lock_if_idle(self) -> None:
        with self._lock:
            if not self.store or not self.sync or self.sync.busy:
                return
            minutes = self.auto_lock_minutes
            if minutes and time.monotonic() - self.last_activity > minutes * 60:
                log.info("Locking after %s idle minutes", minutes)
                self.lock()


# Request handlers. Each takes (app, path match, JSON body) and returns a JSON-able value.

Handler = Callable[[App, re.Match[str], dict[str, Any]], Any]
ROUTES: list[tuple[str, re.Pattern[str], Handler]] = []


def route(method: str, pattern: str) -> Callable[[Handler], Handler]:
    def register(handler: Handler) -> Handler:
        ROUTES.append((method, re.compile(f"^{pattern}$"), handler))
        return handler

    return register


def _str(body: dict[str, Any], key: str, *, required: bool = True) -> str:
    value = body.get(key)
    if value is None and not required:
        return ""
    if not isinstance(value, str) or (required and not value.strip()):
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", f"{key} is required")
    return value.strip()


def _decimal(body: dict[str, Any], key: str) -> Decimal:
    try:
        return Decimal(str(body[key]))
    except (KeyError, InvalidOperation):
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", f"{key} must be a number") from None


def _institution(institution_id: str) -> institutions.Institution:
    try:
        return institutions.get(institution_id)
    except KeyError:
        raise ApiError(HTTPStatus.NOT_FOUND, "unknown_institution") from None


def _fields(institution: institutions.Institution) -> list[Any]:
    try:
        return registry.fields(institution)
    except ConnectorError as error:
        raise ApiError(HTTPStatus.SERVICE_UNAVAILABLE, error.code, error.detail) from error


def _split_credentials(
    institution: institutions.Institution, values: Any
) -> tuple[dict[str, str], dict[str, str]]:
    """(fields kept as connection settings, secret fields) from what the user typed."""
    if not isinstance(values, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "values must be an object")
    params, secrets = {}, {}
    for prompt in _fields(institution):
        value = values.get(prompt.key)
        if not isinstance(value, str) or not value:
            continue
        if prompt.pattern and not re.match(prompt.pattern, value):
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", prompt.key)
        (secrets if prompt.secret else params)[prompt.key] = value
    return params, secrets


@route("GET", "/api/status")
def get_status(app: App, _: re.Match[str], __: dict[str, Any]) -> Any:
    return app.status()


@route("POST", "/api/vault/create")
def create_vault(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    app.create(_str(body, "passphrase"))
    return app.status()


@route("POST", "/api/vault/unlock")
def unlock_vault(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    app.unlock(_str(body, "passphrase"))
    return app.status()


@route("POST", "/api/vault/lock")
def lock_vault(app: App, _: re.Match[str], __: dict[str, Any]) -> Any:
    app.lock()
    return app.status()


@route("GET", "/api/institutions")
def list_institutions(_: App, __: re.Match[str], ___: dict[str, Any]) -> Any:
    return [
        {
            "id": i.id,
            "name": i.name,
            "products": i.products,
            "connector": i.connector,
            "implemented": i.implemented,
        }
        for i in institutions.catalog()
    ]


@route("GET", "/api/institutions/(?P<id>[\\w-]+)/fields")
def institution_fields(_: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    return [asdict(prompt) for prompt in _fields(_institution(match["id"]))]


@route("GET", "/api/overview")
def overview(app: App, _: re.Match[str], __: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    return {
        "connections": store.connections(),
        "accounts": store.accounts(),
        "history": store.balance_history(),
    }


@route("POST", "/api/connections")
def add_connection(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    store, sync = app.unlocked()
    institution = _institution(_str(body, "institution"))
    params, secrets = _split_credentials(institution, body.get("values", {}))
    label = _str(body, "label", required=False) or institution.name
    connection_id = store.add_connection(institution.id, label, params, secrets, bool(body.get("remember")))
    app.persist()
    job = sync.start(connection_id, secrets)
    return {"connection_id": connection_id, "job": job.to_json()}


@route("PUT", "/api/connections/(?P<id>\\w+)/credentials")
def update_credentials(app: App, match: re.Match[str], body: dict[str, Any]) -> Any:
    store, sync = app.unlocked()
    connection = _connection(store, match["id"])
    params, secrets = _split_credentials(_institution(connection["institution"]), body.get("values", {}))
    store.set_credentials(connection["id"], params, secrets, bool(body.get("remember")))
    app.persist()
    return sync.start(connection["id"], secrets).to_json()


@route("POST", "/api/connections/(?P<id>\\w+)/sync")
def sync_connection(app: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    store, sync = app.unlocked()
    return sync.start(_connection(store, match["id"])["id"]).to_json()


@route("POST", "/api/sync")
def sync_all(app: App, _: re.Match[str], __: dict[str, Any]) -> Any:
    store, sync = app.unlocked()
    return [sync.start(connection["id"]).to_json() for connection in store.connections()]


@route("DELETE", "/api/connections/(?P<id>\\w+)")
def delete_connection(app: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    store.delete_connection(_connection(store, match["id"])["id"])
    app.persist()
    return {}


def _connection(store: Store, connection_id: str) -> dict[str, Any]:
    try:
        return store.connection(connection_id)
    except KeyError:
        raise ApiError(HTTPStatus.NOT_FOUND, "unknown_connection") from None


@route("GET", "/api/jobs/(?P<id>\\w+)")
def get_job(app: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    _store, sync = app.unlocked()
    return _job(sync, match["id"]).to_json()


@route("POST", "/api/jobs/(?P<id>\\w+)/answer")
def answer_job(app: App, match: re.Match[str], body: dict[str, Any]) -> Any:
    _store, sync = app.unlocked()
    job = _job(sync, match["id"])
    try:
        job.answer(_str(body, "value"))
    except ValueError as error:
        raise ApiError(HTTPStatus.CONFLICT, "not_waiting", str(error)) from error
    return job.to_json()


@route("POST", "/api/jobs/(?P<id>\\w+)/cancel")
def cancel_job(app: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    _store, sync = app.unlocked()
    job = _job(sync, match["id"])
    job.cancel()
    return job.to_json()


def _job(sync: SyncService, job_id: str) -> Any:
    try:
        return sync.job(job_id)
    except KeyError:
        raise ApiError(HTTPStatus.NOT_FOUND, "unknown_job") from None


@route("POST", "/api/accounts")
def add_manual_account(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    try:
        kind = AccountKind(_str(body, "kind"))
    except ValueError:
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "kind") from None
    account_id = store.add_manual_account(
        _str(body, "institution_name"),
        _str(body, "label"),
        kind,
        _decimal(body, "balance"),
        _str(body, "currency", required=False) or "EUR",
    )
    app.persist()
    return {"id": account_id}


@route("GET", "/api/accounts/(?P<id>\\w+)")
def account_detail(app: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    return {"holdings": store.holdings(match["id"]), "transactions": store.transactions(match["id"])}


@route("PATCH", "/api/accounts/(?P<id>\\w+)")
def update_account(app: App, match: re.Match[str], body: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    if "balance" in body:
        try:
            store.set_manual_balance(match["id"], _decimal(body, "balance"))
        except KeyError:
            raise ApiError(HTTPStatus.NOT_FOUND, "unknown_manual_account") from None
    hidden = body.get("hidden")
    store.update_account(
        match["id"],
        label=_str(body, "label") if "label" in body else None,
        hidden=hidden if isinstance(hidden, bool) else None,
    )
    app.persist()
    return {}


@route("DELETE", "/api/accounts/(?P<id>\\w+)")
def delete_account(app: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    store.delete_manual_account(match["id"])
    app.persist()
    return {}


@route("PUT", "/api/settings")
def update_settings(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    minutes = body.get("auto_lock_minutes")
    if not isinstance(minutes, int) or not 1 <= minutes <= 240:
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "auto_lock_minutes")
    store.set_setting("auto_lock_minutes", str(minutes))
    app.persist()
    return app.status()


def _find_route(method: str, path: str) -> tuple[Handler, re.Match[str]]:
    for route_method, pattern, handler in ROUTES:
        match = pattern.match(path)
        if match and route_method == method:
            return handler, match
    raise ApiError(HTTPStatus.NOT_FOUND, "not_found")


class RequestHandler(BaseHTTPRequestHandler):
    server: Server
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - signature from the base class
        log.debug(format, *args)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(HTTPStatus.NO_CONTENT, None)

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self._handle("PUT")

    def do_PATCH(self) -> None:  # noqa: N802
        self._handle("PATCH")

    def do_DELETE(self) -> None:  # noqa: N802
        self._handle("DELETE")

    def _handle(self, method: str) -> None:
        try:
            self._check_request()
            path = self.path.split("?", 1)[0]
            handler, match = _find_route(method, path)
            if path != "/api/status":  # status is polled; it isn't user activity
                self.server.app.last_activity = time.monotonic()
            result = handler(self.server.app, match, self._body())
            self._send(HTTPStatus.OK, result)
        except ApiError as error:
            self._send(error.status, {"error": {"code": error.code, "detail": error.detail}})
        except Exception as error:
            log.exception("Request failed")
            detail = f"{type(error).__name__}: {error}"
            self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": {"code": "unexpected", "detail": detail}})

    def _check_request(self) -> None:
        port = self.server.server_address[1]
        if self.headers.get("Host") not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            raise ApiError(HTTPStatus.FORBIDDEN, "bad_host")
        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if not hmac.compare_digest(supplied.encode(), self.server.token.encode()):
            raise ApiError(HTTPStatus.UNAUTHORIZED, "bad_token")

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_json") from None
        if not isinstance(body, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_json")
        return body

    def _send(self, status: HTTPStatus, payload: Any) -> None:
        data = b"" if payload is None else json.dumps(payload, default=str).encode()
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin and origin in self.server.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, app: App, token: str, port: int = 0, extra_origins: set[str] | None = None) -> None:
        if len(token) < 16 and token != "dev":
            raise ValueError("The API token is too short")
        super().__init__(("127.0.0.1", port), RequestHandler)
        self.app = app
        self.token = token
        self.allowed_origins = TAURI_ORIGINS | (extra_origins or set())


def _auto_lock(app: App) -> None:
    while True:
        time.sleep(30)
        try:
            app.lock_if_idle()
        except Exception:
            log.exception("Auto-lock failed")


def _exit_with_parent() -> None:
    """The desktop shell keeps our stdin open; when it goes away, so do we."""
    sys.stdin.read()
    os._exit(0)


def serve(port: int, watch_stdin: bool) -> None:
    for name in CA_OVERRIDES:
        os.environ.pop(name, None)
    token = os.environ.pop("KERFIN_TOKEN", "")
    if not token:
        raise SystemExit("KERFIN_TOKEN must be set")
    dev_origin = os.environ.get("KERFIN_DEV_ORIGIN")
    app = App(paths.data_dir())
    server = Server(app, token, port, {dev_origin} if dev_origin else None)
    threading.Thread(target=_auto_lock, args=(app,), daemon=True).start()
    if watch_stdin:
        threading.Thread(target=_exit_with_parent, daemon=True).start()
    # The desktop shell reads this line to learn the port.
    print(f"KERFIN_ENGINE_READY {server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    finally:
        app.lock()
