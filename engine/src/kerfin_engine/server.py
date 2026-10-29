"""Local HTTP API used by the desktop UI.

Security model:
- listens on 127.0.0.1 only, on a port chosen at start;
- every request must carry the token the desktop shell generated for this launch;
- the Host header must name the loopback address (no DNS rebinding from web pages);
- responses are never cached (WebView2 would otherwise write them to disk in clear);
- the vault locks itself after a period without user activity.
"""

from __future__ import annotations

import base64
import hmac
import json
import logging
import os
import re
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import metadata
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

from kerfin_engine import bank_export, browsers, institutions, paths
from kerfin_engine.connectors import finary, registry
from kerfin_engine.connectors.base import ConnectorError
from kerfin_engine.domain import AccountKind
from kerfin_engine.market import MarketData, index_profiles
from kerfin_engine.store import Store
from kerfin_engine.sync import SyncService
from kerfin_engine.vault import Vault, VaultError, WrongPassphrase

log = logging.getLogger(__name__)

TAURI_ORIGINS = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"}
DEFAULT_AUTO_LOCK_MINUTES = 15
MAX_IMPORT_BYTES = 20 * 1024 * 1024
BUDGET_DAYS = 400  # thirteen months: the last twelve, and the one before to compare
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


# Where Finary sends the browser back after the user approves access. It is the only
# address served without the API token: the browser can't send it, so the sign-in's random
# `state` stands in for it.
FINARY_CALLBACK = "/finary/callback"
open_browser = browsers.open_url  # replaced in tests


@dataclass
class _FinarySignIn:
    sign_in: finary.SignIn
    connection_id: str | None  # signing in again for an existing connection


class App:
    """The engine's state: the vault, the unlocked store and the sync jobs."""

    def __init__(self, data_dir: Path, market: Callable[[Store], MarketData] = MarketData) -> None:
        self.market = market  # replaced in tests, which mustn't reach the internet
        self.vault = Vault(data_dir / "kerfin.vault")
        self.store: Store | None = None
        self.sync: SyncService | None = None
        self.last_activity = time.monotonic()
        self._lock = threading.RLock()
        self.port = 0  # set by the server; Finary's redirection comes back to it
        self.finary_pending: _FinarySignIn | None = None
        self.finary_status: dict[str, Any] = {"state": "idle"}

    # Finary sign-in

    def start_finary_sign_in(self, connection_id: str | None, browser: str) -> str:
        store, _sync = self.unlocked()
        try:
            sign_in = finary.start_sign_in(f"http://127.0.0.1:{self.port}{FINARY_CALLBACK}")
        except ConnectorError as error:
            raise ApiError(HTTPStatus.BAD_GATEWAY, error.code, error.detail) from error
        self.finary_pending = _FinarySignIn(sign_in, connection_id)
        self.finary_status = {"state": "waiting"}
        store.set_setting("browser", browser)
        self.persist()
        threading.Thread(target=open_browser, args=(sign_in.url, browser), daemon=True).start()
        return sign_in.url

    def finish_finary_sign_in(self, query: dict[str, str]) -> tuple[bool, str]:
        """Handles Finary's redirection; returns (success, message for the browser tab)."""
        pending = self.finary_pending
        if not pending or not hmac.compare_digest(
            query.get("state", "").encode(), pending.sign_in.state.encode()
        ):
            return False, "This sign-in has expired. Start again from Kerfin."
        self.finary_pending = None
        if not query.get("code"):
            self.finary_status = {"state": "failed", "error": {"code": "sign_in_cancelled", "detail": ""}}
            return False, "Access wasn't granted. You can start again from Kerfin."
        try:
            store, sync = self.unlocked()
            secrets = finary.finish_sign_in(pending.sign_in, query["code"])
        except (ApiError, ConnectorError) as error:
            log.warning("Finary sign-in failed: %s", error)
            self.finary_status = {
                "state": "failed",
                "error": {"code": getattr(error, "code", ""), "detail": ""},
            }
            return False, "Kerfin couldn't finish signing in to Finary. Try again from Kerfin."
        connection_id = pending.connection_id or next(
            (c["id"] for c in store.connections() if c["institution"] == institutions.FINARY.id), None
        )
        if connection_id:
            store.set_credentials(connection_id, {}, secrets, remember=True)
        else:
            connection_id = store.add_connection(institutions.FINARY.id, "Finary", {}, secrets, remember=True)
        self.persist()
        job = sync.start(connection_id)
        self.finary_status = {"state": "done", "connection_id": connection_id, "job": job.to_json()}
        return True, "Kerfin is connected to Finary. You can close this tab and go back to Kerfin."

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
        self.sync = SyncService(store, self.persist, self.market)
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
    """Every known institution, so existing connections keep their names; `offered` ones can be added."""
    offered = {i.id for i in institutions.catalog()}
    return [
        {
            "id": i.id,
            "name": i.name,
            "products": i.products,
            "connector": i.connector,
            "implemented": i.implemented,
            "offered": i.id in offered,
        }
        for i in institutions.known()
    ]


@route("GET", "/api/institutions/(?P<id>[\\w-]+)/fields")
def institution_fields(_: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    return [asdict(prompt) for prompt in _fields(_institution(match["id"]))]


@route("POST", "/api/finary/sign-in")
def finary_sign_in(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    connection_id = _str(body, "connection_id", required=False) or None
    if connection_id:
        _connection(store, connection_id)
    browser = _str(body, "browser", required=False) or browsers.DEFAULT
    return {"url": app.start_finary_sign_in(connection_id, browser)}


@route("GET", "/api/browsers")
def list_browsers(app: App, _: re.Match[str], __: dict[str, Any]) -> Any:
    """The browsers a sign-in page can open in, and the one chosen last time."""
    store, _sync = app.unlocked()
    return {
        "browsers": [{"id": b.id, "name": b.name} for b in browsers.installed()],
        "selected": store.setting("browser", browsers.DEFAULT),
    }


@route("GET", "/api/finary/sign-in")
def finary_sign_in_status(app: App, _: re.Match[str], __: dict[str, Any]) -> Any:
    app.unlocked()
    return app.finary_status


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


@route("GET", "/api/market")
def market_data(app: App, _: re.Match[str], __: dict[str, Any]) -> Any:
    """Everything the investment analyses need: holdings, their price histories, euro
    exchange rates, and the composition of the main indices."""
    store, _sync = app.unlocked()
    return {"holdings": store.holdings(), **store.market(), "indices": index_profiles()}


@route("GET", "/api/transactions")
def all_transactions(app: App, _: re.Match[str], __: dict[str, Any]) -> Any:
    """Every account's transactions over the last thirteen months, for the budget."""
    store, _sync = app.unlocked()
    return {
        "transactions": store.all_transactions(date.today() - timedelta(days=BUDGET_DAYS)),
        "notices": store.transactions_notices(),
        "rules": store.category_rules(),
        "categories": store.categories(),
    }


CATEGORY_KINDS = {"spending", "income", "excluded"}
# Categories the rules rely on (see packages/core/src/categories.ts).
REQUIRED_CATEGORIES = {"transfers", "other"}


@route("PUT", "/api/categories")
def set_categories(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    """The user's categories: [{key, kind, label}], in their order."""
    store, _sync = app.unlocked()
    given = body.get("categories")
    if not isinstance(given, list) or len(given) > 100:
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "categories")
    categories = []
    for item in given:
        key, kind, label = (item.get(k) if isinstance(item, dict) else None for k in ("key", "kind", "label"))
        if (
            not isinstance(key, str)
            or not re.fullmatch(r"[a-z0-9_]{1,60}", key)
            or kind not in CATEGORY_KINDS
        ):
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "category")
        if label is not None and (not isinstance(label, str) or not label.strip() or len(label) > 60):
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "label")
        categories.append({"key": key, "kind": kind, "label": label.strip() if label else None})
    keys = [c["key"] for c in categories]
    if len(set(keys)) != len(keys) or not REQUIRED_CATEGORIES <= set(keys):
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "categories")
    store.set_categories(categories)
    app.persist()
    return {}


@route("PUT", "/api/category-rules")
def set_category_rule(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    """The user's category for a payee ("payee_key"), or null to go back to Kerfin's own."""
    store, _sync = app.unlocked()
    category = body.get("category")
    if category is not None and (not isinstance(category, str) or not category.strip()):
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "category")
    store.set_category_rule(_str(body, "payee_key"), category.strip() if category else None)
    app.persist()
    return {}


def _export(body: dict[str, Any]) -> list[bank_export.ExportAccount]:
    try:
        data = base64.b64decode(_str(body, "data"), validate=True)
    except ValueError:
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "data") from None
    if len(data) > MAX_IMPORT_BYTES:
        raise ApiError(HTTPStatus.BAD_REQUEST, "file_too_large")
    try:
        return bank_export.read(data)
    except bank_export.ExportError as error:
        raise ApiError(HTTPStatus.BAD_REQUEST, "unreadable_export", str(error)) from None


@route("POST", "/api/imports/preview")
def preview_import(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    """The accounts in a bank's export, each with the account it would go to."""
    store, _sync = app.unlocked()
    found = []
    for account in _export(body):
        amounts = [t.amount for t in account.transactions]
        found.append(
            {
                "number": account.number,
                "label": account.label,
                "count": len(amounts),
                "first": min(t.date for t in account.transactions),
                "last": max(t.date for t in account.transactions),
                "income": str(sum((a for a in amounts if a > 0), Decimal(0))),
                "spending": str(-sum((a for a in amounts if a < 0), Decimal(0))),
                "balance": None if account.balance is None else str(account.balance),
                "target": bank_export.target(store, account),
            }
        )
    return {"accounts": found}


@route("POST", "/api/imports")
def import_export(app: App, _: re.Match[str], body: dict[str, Any]) -> Any:
    """Imports an export's transactions. "targets" says, for each account number, the
    account they go to: an account id, "new" for a new account, or "skip"."""
    store, _sync = app.unlocked()
    targets = body.get("targets")
    if not isinstance(targets, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "targets")
    try:
        imported = bank_export.save(store, _export(body), targets)
    except KeyError:
        raise ApiError(HTTPStatus.NOT_FOUND, "unknown_account") from None
    app.persist()
    return {"imported": imported}


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
    # "kind": an account kind the user picked, or "auto" to go back to the detected one.
    kind = _str(body, "kind") if "kind" in body else None
    try:
        chosen = AccountKind(kind) if kind not in (None, "auto") else None
    except ValueError:
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "kind") from None
    insurer = body.get("insurer")
    # "fee_rate": the contract's yearly fees as a fraction ("0.006"), or null to forget them.
    fee_rate = None
    if body.get("fee_rate") is not None:
        fee_rate = _decimal(body, "fee_rate")
        if not fee_rate.is_finite() or not 0 <= fee_rate < Decimal("0.1"):
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid_input", "fee_rate")
    store.update_account(
        match["id"],
        label=_str(body, "label") if "label" in body else None,
        hidden=hidden if isinstance(hidden, bool) else None,
        kind=chosen,
        reset_kind=kind == "auto",
        insurer=insurer if isinstance(insurer, str) else None,
        fee_rate=fee_rate,
        clear_fee_rate="fee_rate" in body and body["fee_rate"] is None,
    )
    app.persist()
    return {}


@route("DELETE", "/api/accounts/(?P<id>\\w+)")
def delete_account(app: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    store, _sync = app.unlocked()
    try:
        store.delete_account(match["id"])
    except KeyError:
        raise ApiError(HTTPStatus.NOT_FOUND, "unknown_account") from None
    app.persist()
    return {}


@route("POST", "/api/connections/(?P<id>\\w+)/restore-accounts")
def restore_accounts(app: App, match: re.Match[str], __: dict[str, Any]) -> Any:
    """The accounts removed from a connection come back at its next sync."""
    store, _sync = app.unlocked()
    store.restore_accounts(match["id"])
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
        path, _, query = self.path.partition("?")
        if method == "GET" and path == FINARY_CALLBACK:
            self._finary_callback(query)
            return
        try:
            self._check_request()
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

    def _finary_callback(self, query: str) -> None:
        if not self._good_host():
            self._send(HTTPStatus.FORBIDDEN, {"error": {"code": "bad_host", "detail": ""}})
            return
        try:
            ok, message = self.server.app.finish_finary_sign_in(dict(parse_qsl(query)))
        except Exception:
            log.exception("Finary sign-in failed")
            ok, message = False, "Kerfin couldn't finish signing in to Finary. Try again from Kerfin."
        page = (
            "<!doctype html><meta charset=utf-8><title>Kerfin</title>"
            "<body style='font:16px system-ui;max-width:32em;margin:15vh auto;padding:0 16px'>"
            f"<h1>{'Done' if ok else 'Not connected'}</h1><p>{message}</p>"
        ).encode()
        self.send_response(HTTPStatus.OK if ok else HTTPStatus.BAD_REQUEST)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def _good_host(self) -> bool:
        port = self.server.server_address[1]
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def _check_request(self) -> None:
        if not self._good_host():
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
        app.port = self.server_address[1]
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
