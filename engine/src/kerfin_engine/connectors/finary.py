"""Finary as a data source, through the read-only connector it offers to AI assistants (MCP).

Finary maintains the connections to banks, insurers, brokers and exchanges; Kerfin reads
the result with the user's consent and keeps its own history for its analyses.

Sign-in is OAuth 2 with PKCE, as for any MCP client: Kerfin registers itself with Finary's
authorization server, the user approves read-only access on Finary's page in their own
browser, and Kerfin keeps the client id and a refresh token in the vault. Each sync trades
the refresh token for an access token.

Finary documents its tools by name but not the layout of their answers, so reading them is
deliberately tolerant. When an answer can't be read, the error and the log describe its
structure (field names and types, never values) so the mapping can be adjusted.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import secrets
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlencode, urlsplit

import requests

from kerfin_engine.connectors.base import ConnectorError, ErrorCode, InteractionHandler
from kerfin_engine.domain import Account, AccountKind, Holding, Transaction

log = logging.getLogger(__name__)

MCP_URL = os.environ.get("KERFIN_FINARY_MCP_URL", "https://public-api.finary.com/mcp")
SCOPES = "openid profile email offline_access"
PROTOCOL_VERSION = "2025-06-18"
TIMEOUT = 60

# Secrets kept in the vault for a Finary connection.
CLIENT_ID, REFRESH_TOKEN, TOKEN_ENDPOINT = "client_id", "refresh_token", "token_endpoint"


def _session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = "Kerfin (personal finance dashboard)"
    return session


def _json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        raise ConnectorError(
            ErrorCode.UNEXPECTED, f"Finary answered {response.status_code} without JSON"
        ) from None


def _check(response: requests.Response, what: str) -> requests.Response:
    if response.status_code in (401, 403):
        raise ConnectorError(ErrorCode.SIGN_IN_NEEDED, f"{what}: {response.status_code}")
    if response.status_code >= 500:
        raise ConnectorError(ErrorCode.SITE_UNAVAILABLE, f"{what}: {response.status_code}")
    if response.status_code >= 400:
        raise ConnectorError(ErrorCode.UNEXPECTED, f"{what}: {response.status_code} {response.text[:300]}")
    return response


# Sign-in


@dataclass(frozen=True)
class AuthServer:
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str


def discover(session: requests.Session) -> AuthServer:
    """Finds Finary's authorization server from the MCP endpoint, as the MCP specification says."""
    resource = urlsplit(MCP_URL)
    metadata_url = (
        f"{resource.scheme}://{resource.netloc}/.well-known/oauth-protected-resource{resource.path}"
    )
    issuer = _json(_check(session.get(metadata_url, timeout=TIMEOUT), "Finary metadata"))[
        "authorization_servers"
    ][0]
    server = _json(
        _check(
            session.get(f"{issuer}/.well-known/oauth-authorization-server", timeout=TIMEOUT), "Finary sign-in"
        )
    )
    return AuthServer(
        server["authorization_endpoint"], server["token_endpoint"], server["registration_endpoint"]
    )


@dataclass(frozen=True)
class SignIn:
    """A sign-in waiting for the user to approve access in their browser."""

    url: str
    state: str
    verifier: str
    client_id: str
    redirect_uri: str
    token_endpoint: str


def start_sign_in(redirect_uri: str) -> SignIn:
    session = _session()
    server = discover(session)
    # Registered at each sign-in: the redirection goes to the engine, whose port changes at
    # each launch. Refreshing tokens later doesn't need the redirection.
    registration = _json(
        _check(
            session.post(
                server.registration_endpoint,
                json={
                    "client_name": "Kerfin",
                    "redirect_uris": [redirect_uri],
                    "grant_types": ["authorization_code", "refresh_token"],
                    "response_types": ["code"],
                    "token_endpoint_auth_method": "none",
                    "scope": SCOPES,
                },
                timeout=TIMEOUT,
            ),
            "Finary client registration",
        )
    )
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(32)
    query = {
        "response_type": "code",
        "client_id": registration["client_id"],
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "resource": MCP_URL,
        "prompt": "consent",  # needed for a refresh token (offline_access)
    }
    return SignIn(
        url=f"{server.authorization_endpoint}?{urlencode(query)}",
        state=state,
        verifier=verifier,
        client_id=registration["client_id"],
        redirect_uri=redirect_uri,
        token_endpoint=server.token_endpoint,
    )


def finish_sign_in(sign_in: SignIn, code: str) -> dict[str, str]:
    """Trades the code Finary sent back for tokens; returns the connection's secrets."""
    tokens = _token_request(
        sign_in.token_endpoint,
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": sign_in.redirect_uri,
            "client_id": sign_in.client_id,
            "code_verifier": sign_in.verifier,
            "resource": MCP_URL,
        },
    )
    if not tokens.get("refresh_token"):
        raise ConnectorError(ErrorCode.UNEXPECTED, "Finary granted access without a refresh token")
    return {
        CLIENT_ID: sign_in.client_id,
        REFRESH_TOKEN: tokens["refresh_token"],
        TOKEN_ENDPOINT: sign_in.token_endpoint,
    }


def _token_request(token_endpoint: str, data: dict[str, str]) -> dict[str, Any]:
    response = _session().post(token_endpoint, data=data, timeout=TIMEOUT)
    if response.status_code in (400, 401):
        # invalid_grant: the refresh token expired or access was revoked in Finary.
        raise ConnectorError(ErrorCode.SIGN_IN_NEEDED, f"Finary refused the tokens: {response.text[:200]}")
    return _json(_check(response, "Finary tokens"))


# MCP over HTTP (JSON-RPC, answered as JSON or as a server-sent event stream)


class McpClient:
    def __init__(self, access_token: str) -> None:
        self._session = _session()
        self._session.headers.update(
            {"Authorization": f"Bearer {access_token}", "Accept": "application/json, text/event-stream"}
        )
        self._next_id = 0
        self.tools: dict[str, dict[str, Any]] = {}

    def start(self) -> None:
        self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "kerfin", "version": "1"},
            },
        )
        self._notify("notifications/initialized")
        self.tools = {tool["name"]: tool for tool in self._request("tools/list", {}).get("tools", [])}

    def call(self, name: str, arguments: Mapping[str, Any] | None = None) -> Any:
        """A tool's answer: its structured content, or its text parsed as JSON when it is JSON."""
        result = self._request("tools/call", {"name": name, "arguments": dict(arguments or {})})
        texts = [part.get("text", "") for part in result.get("content", []) if part.get("type") == "text"]
        if result.get("isError"):
            raise ConnectorError(ErrorCode.UNEXPECTED, f"Finary tool {name} failed: {' '.join(texts)[:300]}")
        if result.get("structuredContent") is not None:
            return result["structuredContent"]
        text = "\n".join(texts)
        try:
            return json.loads(text)
        except ValueError:
            return text

    def _notify(self, method: str) -> None:
        self._post({"jsonrpc": "2.0", "method": method})

    def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self._next_id += 1
        message = self._post({"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params})
        if message is None:
            raise ConnectorError(ErrorCode.UNEXPECTED, f"Finary sent no answer to {method}")
        if "error" in message:
            raise ConnectorError(ErrorCode.UNEXPECTED, f"Finary {method}: {message['error']}")
        return message.get("result", {})

    def _post(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        try:
            response = self._session.post(MCP_URL, json=payload, timeout=TIMEOUT)
        except requests.exceptions.RequestException as error:
            raise ConnectorError(ErrorCode.CONNECTION_FAILED, str(error)) from error
        _check(response, f"Finary {payload['method']}")
        if session_id := response.headers.get("Mcp-Session-Id"):
            self._session.headers["Mcp-Session-Id"] = session_id
        if response.status_code == 202 or not response.content:
            return None
        if response.headers.get("Content-Type", "").startswith("text/event-stream"):
            return _last_event(response.text, payload.get("id"))
        return _json(response)


def _last_event(stream: str, request_id: Any) -> dict[str, Any] | None:
    """The answer to `request_id` in a server-sent event stream."""
    for event in stream.replace("\r\n", "\n").split("\n\n"):
        data = "\n".join(line[5:].lstrip() for line in event.split("\n") if line.startswith("data:"))
        if data:
            message = json.loads(data)
            if message.get("id") == request_id:
                return message
    return None


# Reading Finary's answers


def shape(value: Any, depth: int = 0) -> Any:
    """The structure of an answer, without its values: safe to log and to show."""
    if depth > 6:
        return "..."
    if isinstance(value, Mapping):
        keys = list(value)
        # Keys that look like data (names with spaces, many of them) aren't shown.
        if len(keys) > 40 or any(not re.fullmatch(r"[A-Za-z_][\w-]{0,40}", str(key)) for key in keys):
            return f"<object with {len(keys)} keys>"
        return {key: shape(value[key], depth + 1) for key in keys}
    if isinstance(value, list):
        if not value:
            return []
        # One sample per resource type: JSON:API lists mix types (e.g. "included").
        samples: dict[str, Any] = {}
        for item in value:
            kind = item.get("type") if isinstance(item, Mapping) else None
            kind = kind if isinstance(kind, str) and re.fullmatch(r"[A-Za-z_]{1,40}", kind) else ""
            samples.setdefault(kind, item)
        return [f"{len(value)} items", *(shape(item, depth + 1) for item in list(samples.values())[:5])]
    return type(value).__name__


def _flat(item: Mapping[str, Any]) -> Mapping[str, Any]:
    """A JSON:API resource as one flat object: its `attributes`, its id and type as
    `resource_type`, and each relationship as `<name>_id` and `<name>_ref`, the (type, id)
    of the linked resource in `included`."""
    attributes = item.get("attributes")
    if not isinstance(attributes, Mapping) and not isinstance(item.get("relationships"), Mapping):
        return item
    flat = {**(attributes or {}), "id": item.get("id"), "resource_type": item.get("type")}
    for name, relationship in (item.get("relationships") or {}).items():
        data = relationship.get("data") if isinstance(relationship, Mapping) else None
        if isinstance(data, Mapping):
            flat[f"{name}_id"] = data.get("id")
            flat[f"{name}_ref"] = (str(data.get("type")), str(data.get("id")))
    return flat


def _included(payload: Any) -> dict[tuple[str, str], Mapping[str, Any]]:
    """JSON:API side resources (institutions, connections...) by (type, id), flattened."""
    items = payload.get("included") if isinstance(payload, Mapping) else None
    return {
        (str(item.get("type")), str(item.get("id"))): _flat(item)
        for item in items or []
        if isinstance(item, Mapping)
    }


_ID_KEYS = ("id", "account_id", "uuid", "slug")
_LABEL_KEYS = ("name", "label", "display_name", "title", "custom_name")
_BALANCE_KEYS = (
    "balance",
    "current_value",
    "value",
    "valuation",
    "current_balance",
    "display_balance",
    "amount",
    "total",
)
_TYPE_KEYS = ("type", "account_type", "category", "kind", "subtype", "subcategory", "asset_type")
_INSTITUTION_KEYS = ("institution", "institution_name", "bank", "provider", "connection", "platform")


def _pick(item: Mapping[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if item.get(key) not in (None, ""):
            return item[key]
    return None


def _name(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = _pick(value, ("name", "display_name", "label", "title"))
    return str(value) if value not in (None, "") else None


def _amount(value: Any) -> tuple[Decimal | None, str | None]:
    """(amount, currency) from 12.5, "12.5", or {"value": 12.5, "currency": "EUR"}."""
    currency = None
    if isinstance(value, Mapping):
        currency = _currency(value)
        value = _pick(value, ("value", "amount", "balance", "display_value"))
    if isinstance(value, bool) or value is None:
        return None, currency
    try:
        return Decimal(str(value)), currency
    except InvalidOperation:
        return None, currency


def _currency(item: Mapping[str, Any]) -> str | None:
    value = _pick(item, ("currency", "currency_code", "display_currency"))
    if isinstance(value, Mapping):
        value = _pick(value, ("code", "symbol", "name"))
    return str(value).upper() if value else None


def _records(payload: Any, required: Iterable[str]) -> list[Mapping[str, Any]]:
    """The largest list of objects in `payload` whose items have one of the `required` keys."""
    required = tuple(required)
    best: list[Mapping[str, Any]] = []

    def visit(value: Any, depth: int) -> None:
        nonlocal best
        if depth > 6:
            return
        if isinstance(value, list):
            items = [_flat(item) for item in value if isinstance(item, Mapping)]
            if items and any(_pick(item, required) is not None for item in items) and len(items) > len(best):
                best = items
            for item in items:
                visit(item, depth + 1)
        elif isinstance(value, Mapping):
            for child in value.values():
                visit(child, depth + 1)

    visit(payload, 0)
    return best


_KINDS: tuple[tuple[str, AccountKind], ...] = (
    (r"loan|cr[eé]dit|mortgage|pr[eê]t|emprunt", AccountKind.LOAN),
    (r"card|carte", AccountKind.CARD),
    (r"\bpea\b|pea[_ -]?pme", AccountKind.PEA),
    (r"\bper\b|perco|perp|madelin|retire|pension|retraite", AccountKind.RETIREMENT),
    (r"life|assurance|insur|capitali", AccountKind.LIFE_INSURANCE),
    (r"crypto|wallet|bitcoin|exchange", AccountKind.CRYPTO),
    (r"crowd", AccountKind.CROWDFUNDING),
    (r"real[_ ]?estate|scpi|immo|property|propert", AccountKind.REAL_ESTATE),
    (r"\bpee\b|employee|[ée]pargne salariale", AccountKind.EMPLOYEE_SAVINGS),
    (r"savings|livret|ldd|\bpel\b|\bcel\b|[ée]pargne|deposit", AccountKind.SAVINGS),
    (r"checking|current|courant|bank", AccountKind.CHECKING),
    (r"securit|brokerage|cto|stock|invest|titres", AccountKind.SECURITIES),
)


def account_kind(*descriptions: str | None) -> AccountKind:
    text = " ".join(d.lower() for d in descriptions if d)
    for pattern, kind in _KINDS:
        if re.search(pattern, text):
            return kind
    return AccountKind.OTHER


def _institution(
    item: Mapping[str, Any], included: dict[tuple[str, str], Mapping[str, Any]]
) -> Mapping[str, Any]:
    """The account's institution resource, through Finary's JSON:API links (account ->
    institution connection -> institution), followed by the types the links themselves give."""
    connection = included.get(item.get("institution_connection_ref"), {})  # type: ignore[arg-type]
    return included.get(connection.get("institution_ref") or item.get("institution_ref"), {})  # type: ignore[arg-type]


# Institution kinds that say what an account holds, when its own type is just "investment".
_PRODUCT_KINDS = {
    AccountKind.LIFE_INSURANCE,
    AccountKind.CRYPTO,
    AccountKind.CROWDFUNDING,
    AccountKind.REAL_ESTATE,
}


def accounts_from(payload: Any) -> list[Account]:
    included = _included(payload)
    found = []
    for item in _records(payload, _BALANCE_KEYS):
        # Finary values the user's share of each account in euros (joint accounts, other
        # currencies): that is what their wealth is made of.
        if item.get("total_owned_value_eur") not in (None, ""):
            balance, currency = _amount(item["total_owned_value_eur"])[0], "EUR"
        else:
            balance, currency = _amount(_pick(item, _BALANCE_KEYS))
            currency = _currency(item) or currency
        identifier = _pick(item, _ID_KEYS)
        label = _name(_pick(item, _LABEL_KEYS))
        if identifier is None and label is None:
            continue
        type_text = [_name(item.get(key)) for key in _TYPE_KEYS]
        institution = _institution(item, included)
        # The name often says more than the type ("PEA", "Assurance vie..."); Finary types
        # many accounts as just "investment".
        kind = account_kind(label, *type_text)
        if kind in (AccountKind.OTHER, AccountKind.SECURITIES):
            from_institution = account_kind(_name(institution.get("kind")))
            kind = from_institution if from_institution in _PRODUCT_KINDS else kind
        found.append(
            Account(
                external_id=str(identifier if identifier is not None else label),
                label=label or str(identifier),
                kind=kind,
                balance=balance,
                currency=currency or "EUR",
                subtype=next((text for text in type_text if text), None),
                institution=_name(_pick(item, _INSTITUTION_KEYS)) or _name(_pick(institution, _LABEL_KEYS)),
            )
        )
    return found


def holdings_from(payload: Any) -> dict[str | None, list[Holding]]:
    """Holdings by Finary account id (None when the answer doesn't say)."""
    by_account: dict[str | None, list[Holding]] = {}
    for item in _records(payload, ("quantity", "isin", "valuation", "current_value", "value")):
        valuation, currency = _amount(
            _pick(item, ("current_value", "valuation", "value", "amount", "balance"))
        )
        account = item.get("account_id") or item.get("account")
        if isinstance(account, Mapping):
            account = _pick(account, _ID_KEYS)
        isin = _pick(item, ("isin", "isin_code"))
        security = item.get("security") if isinstance(item.get("security"), Mapping) else {}
        isin = isin or _pick(security, ("isin", "isin_code"))
        quantity, _ = _amount(_pick(item, ("quantity", "shares", "units")))
        unit_value, _ = _amount(_pick(item, ("unit_value", "price", "current_price", "last_price")))
        unit_price, _ = _amount(
            _pick(item, ("unit_price", "buying_price", "average_price", "cost_basis_per_unit"))
        )
        by_account.setdefault(None if account is None else str(account), []).append(
            Holding(
                label=_name(_pick(item, _LABEL_KEYS)) or _name(_pick(security, _LABEL_KEYS)) or isin or "?",
                valuation=valuation,
                currency=_currency(item) or currency,
                isin=str(isin) if isin else None,
                quantity=quantity,
                unit_value=unit_value,
                unit_price=unit_price,
            )
        )
    return by_account


class FinaryConnector:
    """One sync's session with Finary. `secrets` holds what `finish_sign_in` returned."""

    def __init__(self, secrets: Mapping[str, str], interaction: InteractionHandler | None = None) -> None:
        missing = [key for key in (CLIENT_ID, REFRESH_TOKEN, TOKEN_ENDPOINT) if not secrets.get(key)]
        if missing:
            raise ConnectorError(ErrorCode.SIGN_IN_NEEDED, "Not signed in to Finary")
        tokens = _token_request(
            secrets[TOKEN_ENDPOINT],
            {
                "grant_type": "refresh_token",
                "refresh_token": secrets[REFRESH_TOKEN],
                "client_id": secrets[CLIENT_ID],
                "resource": MCP_URL,
            },
        )
        # Finary may rotate the refresh token: the sync service saves the new one.
        self.updated_secrets: dict[str, str] | None = None
        if tokens.get("refresh_token") and tokens["refresh_token"] != secrets[REFRESH_TOKEN]:
            self.updated_secrets = {**secrets, REFRESH_TOKEN: tokens["refresh_token"]}
        self._mcp = McpClient(tokens["access_token"])
        self._mcp.start()
        # Parameter names only: they say how to ask for holdings and other details.
        log.info(
            "Finary tools: %s",
            {
                name: sorted((tool.get("inputSchema") or {}).get("properties") or {})
                for name, tool in sorted(self._mcp.tools.items())
            },
        )
        self._holdings: dict[str | None, list[Holding]] | None = None

    def accounts(self) -> list[Account]:
        payload = self._mcp.call("accounts")
        log.info("Finary accounts answer: %s", json.dumps(shape(payload)))
        found = accounts_from(payload)
        # Category names, not personal data: they tune the account kinds.
        log.info("Finary account types: %s", sorted({str(a.subtype) for a in found}))
        log.info("Finary account kinds: %s", sorted({str(a.kind) for a in found}))
        log.info(
            "Finary included types and institution kinds: %s, %s",
            sorted({ref[0] for ref in _included(payload)}),
            sorted({str(i.get("kind")) for i in _included(payload).values() if "kind" in i}),
        )
        log.info(
            "Finary institutions found for %s of %s accounts",
            sum(bool(a.institution) for a in found),
            len(found),
        )
        if not found:
            raise ConnectorError(
                ErrorCode.UNEXPECTED,
                f"Finary's account list has an unknown layout: {json.dumps(shape(payload))}",
            )
        self._log_overview()
        return found

    def _log_overview(self) -> None:
        """The structure of Finary's portfolio overview (gains, variations...), to read it next."""
        tool = self._mcp.tools.get("get_portfolio_overview")
        if tool is None or (tool.get("inputSchema") or {}).get("required"):
            return
        try:
            log.info(
                "Finary overview answer: %s", json.dumps(shape(self._mcp.call("get_portfolio_overview")))
            )
        except ConnectorError as error:
            log.info("Finary overview unavailable: %s", error.code)

    def holdings(self, account_id: str) -> list[Holding]:
        tool = self._mcp.tools.get("holdings")
        if tool is None:
            return []
        required = (tool.get("inputSchema") or {}).get("required") or []
        if not required:
            if self._holdings is None:
                payload = self._mcp.call("holdings")
                log.info("Finary holdings answer: %s", json.dumps(shape(payload)))
                self._holdings = holdings_from(payload)
            return self._holdings.get(account_id, [])
        if len(required) == 1 and "account" in required[0]:
            # One account at a time: its holdings may not repeat the account's id.
            payload = self._mcp.call("holdings", {required[0]: account_id})
            if self._holdings is None:
                log.info("Finary holdings answer: %s", json.dumps(shape(payload)))
                self._holdings = {}
            found = holdings_from(payload)
            return found.get(account_id) or found.get(None) or [h for hs in found.values() for h in hs]
        log.info("Finary holdings needs %s: not read yet", required)
        return []

    def transactions(self, account_id: str, limit: int | None = None) -> list[Transaction]:
        return []  # balances and holdings first; transactions need Finary's Budget feature

    def close(self) -> None:
        pass
