from __future__ import annotations

import base64
import hashlib
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit

import pytest

from kerfin_engine.connectors import finary

FINARY_ACCOUNTS = {
    "accounts": [
        {
            "id": "acc-1",
            "name": "Livret A",
            "type": "savings",
            "institution": {"name": "BoursoBank"},
            "balance": {"value": 22950.5, "currency": "EUR"},
        },
        {
            "id": "acc-2",
            "name": "Linxea Spirit 2",
            "category": "life_insurance",
            "institution_name": "Spirica",
            "current_value": "48210.37",
            "currency": {"code": "eur"},
        },
        {"id": "acc-3", "name": "Bitpanda", "type": "crypto", "balance": 1200, "currency": "EUR"},
    ]
}

FINARY_HOLDINGS = {
    "holdings": [
        {"account_id": "acc-2", "name": "Fonds euros", "current_value": 28000},
        {
            "account_id": "acc-2",
            "security": {"name": "MSCI World", "isin": "IE00B4L5Y983"},
            "quantity": 41.2,
            "current_value": 20210.37,
        },
    ]
}


class FakeFinary:
    """Finary's sign-in and MCP endpoints, as far as Kerfin uses them."""

    def __init__(self) -> None:
        self.challenges: dict[str, str] = {}  # code -> PKCE challenge
        self.redirect_uris: list[str] = []
        self.refresh_tokens = {"r1"}
        self.calls: list[str] = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def _reply(self, status: int, body: Any = None, headers: dict[str, str] | None = None) -> None:
                data = (
                    b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
                )
                self.send_response(status)
                for name, value in (headers or {"Content-Type": "application/json"}).items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _form(self) -> dict[str, str]:
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
                return (
                    dict(parse_qsl(raw))
                    if "form" in self.headers.get("Content-Type", "")
                    else json.loads(raw)
                )

            def do_GET(self) -> None:  # noqa: N802
                url = urlsplit(self.path)
                if url.path == "/.well-known/oauth-protected-resource/mcp":
                    self._reply(200, {"authorization_servers": [fake.base]})
                elif url.path == "/.well-known/oauth-authorization-server":
                    self._reply(
                        200,
                        {
                            "authorization_endpoint": f"{fake.base}/oauth/authorize",
                            "token_endpoint": f"{fake.base}/oauth/token",
                            "registration_endpoint": f"{fake.base}/oauth/register",
                        },
                    )
                elif url.path == "/oauth/authorize":
                    query = dict(parse_qsl(url.query))
                    assert query["client_id"] == "client-1" and "offline_access" in query["scope"]
                    fake.challenges["code-1"] = query["code_challenge"]
                    target = (
                        f"{query['redirect_uri']}?{urlencode({'code': 'code-1', 'state': query['state']})}"
                    )
                    self._reply(302, headers={"Location": target})
                else:
                    self._reply(404, {})

            def do_POST(self) -> None:  # noqa: N802
                path = urlsplit(self.path).path
                body = self._form()
                if path == "/oauth/register":
                    fake.redirect_uris += body["redirect_uris"]
                    self._reply(201, {"client_id": "client-1"})
                elif path == "/oauth/token":
                    self._token(body)
                elif path == "/mcp":
                    self._mcp(body)
                else:
                    self._reply(404, {})

            def _token(self, body: dict[str, str]) -> None:
                if body["grant_type"] == "authorization_code":
                    digest = hashlib.sha256(body["code_verifier"].encode()).digest()
                    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
                    if fake.challenges.pop(body["code"], None) != expected:
                        self._reply(400, {"error": "invalid_grant"})
                        return
                    self._reply(200, {"access_token": "access-1", "refresh_token": "r1", "expires_in": 3600})
                elif body["refresh_token"] in fake.refresh_tokens:
                    # Rotates the refresh token, as many OAuth servers do.
                    fake.refresh_tokens = {"r2"}
                    self._reply(200, {"access_token": "access-2", "refresh_token": "r2", "expires_in": 3600})
                else:
                    self._reply(400, {"error": "invalid_grant"})

            def _mcp(self, message: dict[str, Any]) -> None:
                if not self.headers.get("Authorization", "").startswith("Bearer access-"):
                    self._reply(401, {})
                    return
                method = message["method"]
                fake.calls.append(method if method != "tools/call" else message["params"]["name"])
                if "id" not in message:
                    self._reply(202)
                elif method == "initialize":
                    self._reply(
                        200, {"jsonrpc": "2.0", "id": message["id"], "result": {}}, {"Mcp-Session-Id": "s1"}
                    )
                elif method == "tools/list":
                    tools = [{"name": "accounts", "inputSchema": {}}, {"name": "holdings", "inputSchema": {}}]
                    self._reply(200, {"jsonrpc": "2.0", "id": message["id"], "result": {"tools": tools}})
                elif method == "tools/call":
                    name = message["params"]["name"]
                    payload = FINARY_ACCOUNTS if name == "accounts" else FINARY_HOLDINGS
                    result = {"content": [{"type": "text", "text": json.dumps(payload)}]}
                    answer = json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result})
                    # Answered as a server-sent event stream, which the MCP transport allows.
                    stream = f"event: message\ndata: {answer}\n\n".encode()
                    self._reply(200, stream, {"Content-Type": "text/event-stream"})

        return Handler


@pytest.fixture
def fake_finary(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeFinary]:
    fake = FakeFinary()
    threading.Thread(target=fake.server.serve_forever, daemon=True).start()
    monkeypatch.setattr(finary, "MCP_URL", f"{fake.base}/mcp")
    yield fake
    fake.server.shutdown()
    fake.server.server_close()
