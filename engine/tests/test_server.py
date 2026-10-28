from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import NoMarket

from kerfin_engine import institutions, paths
from kerfin_engine import server as server_module
from kerfin_engine import vault as vault_module
from kerfin_engine.connectors import demo
from kerfin_engine.server import App, Server

TOKEN = "t" * 32
PASSPHRASE = "correct horse battery"


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    monkeypatch.setenv("KERFIN_DEMO", "1")
    monkeypatch.setitem(vault_module.DEFAULT_KDF, "memory_cost", 1024)
    monkeypatch.setitem(vault_module.DEFAULT_KDF, "iterations", 1)
    server = Server(App(tmp_path, market=NoMarket), TOKEN)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]

    def call(method: str, path: str, body: Any = None, token: str = TOKEN, host: str | None = None) -> Any:
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}{path}",
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        if host:
            request.add_header("Host", host)
        try:
            with urllib.request.urlopen(request) as response:
                assert response.headers["Cache-Control"] == "no-store"
                return json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            return {"status": error.code, **json.loads(error.read())}

    call.server = server
    yield call
    server.shutdown()
    server.server_close()


def wait_for(call: Any, job_id: str, *states: str) -> dict[str, Any]:
    for _ in range(200):
        job = call("GET", f"/api/jobs/{job_id}")
        if job["state"] in states:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job stuck in {job['state']}")


def test_rejects_bad_token_and_foreign_host(api: Any) -> None:
    assert api("GET", "/api/status", token="nope")["error"]["code"] == "bad_token"
    assert api("GET", "/api/status", host="evil.example:80")["error"]["code"] == "bad_host"


def test_vault_lifecycle(api: Any) -> None:
    assert api("GET", "/api/status")["vault"] == "missing"
    assert api("GET", "/api/overview")["status"] == 423
    assert api("POST", "/api/vault/create", {"passphrase": "short"})["error"]["code"] == "invalid_passphrase"
    assert api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})["vault"] == "unlocked"
    assert api("POST", "/api/vault/lock")["vault"] == "locked"
    assert api("POST", "/api/vault/unlock", {"passphrase": "wrong one!!"})["status"] == 401
    assert api("POST", "/api/vault/unlock", {"passphrase": PASSPHRASE})["vault"] == "unlocked"


def test_add_connection_with_sms_code(api: Any) -> None:
    api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})
    fields = api("GET", "/api/institutions/demo/fields")
    assert [f["key"] for f in fields] == ["login", "password"] and fields[1]["secret"]

    created = api(
        "POST",
        "/api/connections",
        {"institution": "demo", "values": {"login": "me", "password": "pw"}, "remember": False},
    )
    job = wait_for(api, created["job"]["id"], "waiting")
    assert job["prompt"]["key"] == "otp_sms" and "SMS" in job["messages"][0]
    api("POST", f"/api/jobs/{job['id']}/answer", {"value": "123456"})
    assert wait_for(api, job["id"], "done", "failed")["accounts_found"] == 5

    overview = api("GET", "/api/overview")
    assert len(overview["accounts"]) == 5 and overview["connections"][0]["last_status"] == "ok"

    # The password wasn't remembered: the next sync asks for it first.
    job = api("POST", f"/api/connections/{created['connection_id']}/sync")
    assert wait_for(api, job["id"], "waiting")["prompt"]["key"] == "password"
    api("POST", f"/api/jobs/{job['id']}/cancel")
    assert wait_for(api, job["id"], "cancelled")["state"] == "cancelled"


def test_wrong_password_is_reported(api: Any) -> None:
    api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})
    created = api(
        "POST", "/api/connections", {"institution": "demo", "values": {"login": "me", "password": "wrong"}}
    )
    job = wait_for(api, created["job"]["id"], "failed")
    assert job["error"]["code"] == "invalid_credentials"
    assert api("GET", "/api/overview")["connections"][0]["last_status"] == "invalid_credentials"


def test_manual_account_persists_across_lock(api: Any) -> None:
    api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})
    body = {"institution_name": "Baloise", "label": "Luxavie", "kind": "life_insurance", "balance": "1200.5"}
    account_id = api("POST", "/api/accounts", body)["id"]
    api("PATCH", f"/api/accounts/{account_id}", {"balance": "1300"})
    api("POST", "/api/vault/lock")
    api("POST", "/api/vault/unlock", {"passphrase": PASSPHRASE})
    [account] = api("GET", "/api/overview")["accounts"]
    assert account["balance"] == "1300" and account["currency"] == "EUR"
    assert api("POST", "/api/accounts", {**body, "kind": "bogus"})["status"] == 400


def test_auto_lock_after_idle(api: Any) -> None:
    api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})
    app = api.server.app
    app.last_activity -= 16 * 60
    app.lock_if_idle()
    assert api("GET", "/api/status")["vault"] == "locked"


def test_qr_code_is_shown_while_the_job_runs(api: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(demo, "QR_SECONDS", 1)
    api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})
    created = api(
        "POST", "/api/connections", {"institution": "demo", "values": {"login": "me", "password": "qr"}}
    )
    deadline = time.monotonic() + 5
    while not (job := api("GET", f"/api/jobs/{created['job']['id']}"))["qr_code"]:
        assert time.monotonic() < deadline, job
        time.sleep(0.05)
    assert job["state"] == "running"
    done = wait_for(api, job["id"], "done", "failed")
    assert done["accounts_found"] == 5 and done["qr_code"] is None


def test_website_logins_are_no_longer_offered_but_still_known(api: Any) -> None:
    api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})
    assert [i["id"] for i in api("GET", "/api/institutions") if i["offered"]] == ["finary", "demo"]
    known = {i.id for i in institutions.known()}
    assert {"boursobank", "luxavie"} <= known
    if paths.woob_modules_dir().is_dir():
        assert {"bnp", "fortuneo"} <= known
    # Existing connections to them still open their login form.
    assert api("GET", "/api/institutions/boursobank/fields")[0]["key"] == "login"


def test_finary_sign_in_then_sync(api: Any, fake_finary: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(server_module, "open_browser", lambda url, browser: opened.append(url))
    api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})
    assert [i["id"] for i in api("GET", "/api/institutions") if i["offered"]] == ["finary", "demo"]

    url = api("POST", "/api/finary/sign-in", {"browser": "firefox"})["url"]
    assert api("GET", "/api/browsers")["selected"] == "firefox"
    assert api("GET", "/api/finary/sign-in")["state"] == "waiting"
    deadline = time.monotonic() + 2
    while not opened:
        assert time.monotonic() < deadline
        time.sleep(0.01)
    assert opened == [url]
    # The user approves in the browser: Finary redirects to the engine, which finishes the sign-in.
    with urllib.request.urlopen(url) as page:
        assert b"connected to Finary" in page.read()
    assert fake_finary.redirect_uris == [f"http://127.0.0.1:{api.server.server_address[1]}/finary/callback"]

    status = api("GET", "/api/finary/sign-in")
    assert status["state"] == "done"
    assert wait_for(api, status["job"]["id"], "done", "failed")["accounts_found"] == 3
    accounts = {a["label"]: a for a in api("GET", "/api/overview")["accounts"]}
    assert accounts["Livret A"]["institution_name"] == "BoursoBank"
    assert len(api("GET", f"/api/accounts/{accounts['Linxea Spirit 2']['id']}")["holdings"]) == 2
    # The rotated refresh token was kept: the next sync works.
    job = api("POST", f"/api/connections/{status['connection_id']}/sync")
    assert wait_for(api, job["id"], "done", "failed")["state"] == "done"


def test_finary_callback_needs_the_sign_in_state(api: Any) -> None:
    port = api.server.server_address[1]
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/finary/callback?code=x&state=forged")
    assert error.value.code == 400


def test_account_kind_and_insurer_can_be_set(api: Any) -> None:
    api("POST", "/api/vault/create", {"passphrase": PASSPHRASE})
    body = {"institution_name": "LinXea", "label": "Linxea Avenir", "kind": "securities", "balance": "10"}
    account_id = api("POST", "/api/accounts", body)["id"]
    api("PATCH", f"/api/accounts/{account_id}", {"kind": "life_insurance", "insurer": "Suravenir"})
    [account] = api("GET", "/api/overview")["accounts"]
    assert (account["kind"], account["insurer"], account["insurer_suggested"]) == (
        "life_insurance",
        "Suravenir",
        None,
    )
    assert api("PATCH", f"/api/accounts/{account_id}", {"kind": "bogus"})["status"] == 400
    api("PATCH", f"/api/accounts/{account_id}", {"kind": "auto"})
    assert api("GET", "/api/overview")["accounts"][0]["kind"] == "securities"
