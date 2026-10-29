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
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import requests

from kerfin_engine import insurers
from kerfin_engine.connectors.base import ConnectorError, ErrorCode, InteractionHandler
from kerfin_engine.domain import Account, AccountKind, Holding, Transaction

log = logging.getLogger(__name__)

MCP_URL = os.environ.get("KERFIN_FINARY_MCP_URL", "https://public-api.finary.com/mcp")
SCOPES = "openid profile email offline_access"
PROTOCOL_VERSION = "2025-06-18"
TIMEOUT = 60
# Transactions read at each sync: a year and a month, for the budget's months to compare.
TRANSACTION_DAYS = 400
TRANSACTION_PAGES = 50

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


def _linked(included: dict[tuple[str, str], Mapping[str, Any]], ref: Any) -> Mapping[str, Any]:
    """The resource a relationship points to. A link may name a general type ("asset")
    while the resource has its own ("securities"): then the id alone finds it."""
    if not isinstance(ref, tuple):
        return {}
    if ref in included:
        return included[ref]
    same_id = [resource for (_, resource_id), resource in included.items() if resource_id == ref[1]]
    return same_id[0] if len(same_id) == 1 else {}


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
    # Whole words only: "Lucya Cardif PER" is no card.
    (r"\bcard\b|\bcarte\b", AccountKind.CARD),
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
    connection = _linked(included, item.get("institution_connection_ref"))
    return _linked(included, connection.get("institution_ref") or item.get("institution_ref"))


_BANKING_KINDS = {AccountKind.CARD, AccountKind.CHECKING, AccountKind.LOAN}

# Institution kinds that say what an account holds, when its own type is just "investment".
_PRODUCT_KINDS = {
    AccountKind.LIFE_INSURANCE,
    AccountKind.CRYPTO,
    AccountKind.CROWDFUNDING,
    AccountKind.REAL_ESTATE,
}


def _sync_warnings(payload: Any) -> dict[str, tuple[str, str | None]]:
    """Accounts Finary can't currently update from their institution: {account id: (reason,
    last successful sync)}, from the warnings its account list starts with."""
    warnings = payload.get("sync_warnings") if isinstance(payload, Mapping) else None
    found: dict[str, tuple[str, str | None]] = {}
    for warning in warnings if isinstance(warnings, list) else []:
        if not isinstance(warning, Mapping):
            continue
        reason = _name(_pick(warning, ("reason", "message", "error_message", "status"))) or "unknown"
        since = _name(warning.get("last_successful_sync_at"))
        for account_id in warning.get("account_ids") or []:
            found[str(account_id)] = (reason, since)
    return found


def accounts_from(payload: Any) -> list[Account]:
    included = _included(payload)
    warnings = _sync_warnings(payload)
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
        connection = _linked(included, item.get("institution_connection_ref"))
        warning = warnings.get(str(identifier))
        error = _name(connection.get("error_message"))
        # The name often says more than the type ("PEA", "Assurance vie..."); Finary types
        # many accounts as just "investment".
        kind = account_kind(label, *type_text)
        if kind in _BANKING_KINDS and any(text and "invest" in text.lower() for text in type_text):
            # Finary says it's an investment: a word in its name can't make it a card or a loan.
            kind = AccountKind.SECURITIES
        if kind in (AccountKind.OTHER, AccountKind.SECURITIES):
            from_institution = account_kind(_name(institution.get("kind")))
            kind = from_institution if from_institution in _PRODUCT_KINDS else kind
        if kind in (AccountKind.OTHER, AccountKind.SECURITIES) and insurers.suggest(label):
            # A known insurance contract ("Linxea Spirit 2"...): life insurance.
            kind = AccountKind.LIFE_INSURANCE
        found.append(
            Account(
                external_id=str(identifier if identifier is not None else label),
                label=label or str(identifier),
                kind=kind,
                balance=balance,
                currency=currency or "EUR",
                subtype=next((text for text in type_text if text), None),
                institution=_name(_pick(item, _INSTITUTION_KEYS)) or _name(_pick(institution, _LABEL_KEYS)),
                source_synced_at=(warning[1] if warning else None)
                or _name(connection.get("last_successful_sync_at")),
                sync_warning=(warning[0] if warning else None) or error,
            )
        )
    return found


def holdings_from(payload: Any) -> dict[str | None, list[Holding]]:
    """Holdings by Finary account id (None when the answer doesn't say).

    Each holding's security comes from its link. When no link leads anywhere (Finary's
    holdings point to "assets" it doesn't include), holdings and the included securities are
    paired by their order in the answer: a guess, marked in `match` for the user to check.
    """
    by_account: dict[str | None, list[Holding]] = {}
    included = _included(payload)
    data = payload.get("data") if isinstance(payload, Mapping) else None
    records = (
        [_flat(item) for item in data if isinstance(item, Mapping)]
        if isinstance(data, list)
        else _records(payload, ("quantity", "isin", "valuation", "current_value", "value"))
    )
    securities: list[Mapping[str, Any]] = []
    matches: list[str | None] = []
    for item in records:
        nested = item.get("security") if isinstance(item.get("security"), Mapping) else None
        security = nested or _linked(included, item.get("asset_ref") or item.get("security_ref"))
        securities.append(security)
        matches.append("linked" if security else None)
    unpaired: list[Mapping[str, Any]] = []
    if records and included and not any(securities):
        # Finary sends its lines sorted by their security's ISIN, but the securities in no
        # fixed order (it changed between two syncs): sorting the securities by ISIN lines
        # them up (checked against Finary's own view of an account, 2026-10-28).
        # Resources without an ISIN (currencies) keep their place after them.
        candidates = sorted(
            included.values(),
            key=lambda resource: (resource.get("isin") is None, str(resource.get("isin") or "")),
        )
        # Lines with a name of their own (a euro fund, cash) describe themselves: they are
        # not among the securities (seen on a real account, 2026-10-28).
        pairable = [i for i, item in enumerate(records) if not _name(_pick(item, _LABEL_KEYS))]
        certain = len(candidates) == len(pairable)
        for n, i in enumerate(pairable):
            securities[i] = candidates[n] if n < len(candidates) else {}
            matches[i] = "order" if certain else "order_uncertain"
        unpaired = candidates[len(pairable) :]
    for item, security, match in zip(records, securities, matches, strict=True):
        valuation, currency = _amount(
            _pick(item, ("current_value", "valuation", "value", "amount", "balance"))
        )
        account = item.get("account_id") or item.get("account")
        if isinstance(account, Mapping):
            account = _pick(account, _ID_KEYS)
        isin = _pick(item, ("isin", "isin_code")) or _pick(security, ("isin", "isin_code"))
        quantity, _ = _amount(_pick(item, ("quantity", "shares", "units")))
        price_keys = ("unit_value", "price", "current_price", "last_price")
        unit_value, _ = _amount(_pick(item, price_keys) or _pick(security, price_keys))
        unit_price, _ = _amount(
            _pick(item, ("unit_price", "buying_price", "average_price", "cost_basis_per_unit"))
        )
        fees, _ = _amount(_pick(item, _FEE_KEYS) or _pick(security, _FEE_KEYS))
        entry_fees, _ = _amount(_pick(item, _ENTRY_FEE_KEYS) or _pick(security, _ENTRY_FEE_KEYS))
        annual_yield, _ = _amount(_pick(item, _YIELD_KEYS))
        by_account.setdefault(None if account is None else str(account), []).append(
            Holding(
                label=_name(_pick(item, _LABEL_KEYS)) or _name(_pick(security, _LABEL_KEYS)) or isin or "?",
                valuation=valuation,
                currency=_upper(item.get("current_value_currency")) or _currency(item) or currency,
                isin=str(isin) if isin else None,
                quantity=quantity,
                unit_value=unit_value,
                unit_price=unit_price,
                unit_value_currency=_upper(
                    _pick(security, ("current_price_currency_code", "currency_code", "currency"))
                ),
                security_type=_name(_pick(item, _SECURITY_TYPE_KEYS) or _pick(security, _SECURITY_TYPE_KEYS)),
                fees=_fraction(fees),
                entry_fees=_entry_fraction(entry_fees),
                annual_yield=_yield(annual_yield),
                match=match,
            )
        )
    # Securities left over when they outnumber the holdings: listed, without a value.
    for security in unpaired:
        fees, _ = _amount(_pick(security, _FEE_KEYS))
        price, _ = _amount(_pick(security, ("current_price", "price", "last_price")))
        currency = _upper(_pick(security, ("current_price_currency_code", "currency_code", "currency")))
        isin = _pick(security, ("isin", "isin_code"))
        by_account.setdefault(None, []).append(
            Holding(
                label=_name(_pick(security, _LABEL_KEYS)) or isin or "?",
                valuation=None,
                currency=currency,
                isin=str(isin) if isin else None,
                unit_value=price,
                unit_value_currency=currency,
                security_type=_name(_pick(security, _SECURITY_TYPE_KEYS)),
                fees=_fraction(fees),
                match="unpaired",
            )
        )
    return by_account


_DATE_KEYS = (
    "date",
    "transaction_date",
    "booking_date",
    "booked_at",
    "value_date",
    "display_date",
    "created_at",
)
_TRANSACTION_LABEL_KEYS = (
    "display_name",
    "simplified_description",
    "name",
    "label",
    "description",
    "original_description",
    "title",
)
# Directions Finary may give with an unsigned amount.
_OUTGOING = {"debit", "out", "outflow", "outgoing", "expense", "spending"}


def _day(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def transactions_from(payload: Any) -> dict[str | None, list[Transaction]]:
    """Transactions by Finary account id (None when the answer doesn't say)."""
    included = _included(payload)
    data = payload.get("data") if isinstance(payload, Mapping) else None
    records = (
        [_flat(item) for item in data if isinstance(item, Mapping)]
        if isinstance(data, list)
        else _records(payload, ("amount", "value"))
    )
    found: dict[str | None, list[Transaction]] = {}
    for item in records:
        amount, currency = _amount(_pick(item, ("amount", "value", "display_value")))
        day = _day(_pick(item, _DATE_KEYS))
        if amount is None or day is None:
            continue
        direction = str(item.get("direction") or item.get("type_of_flow") or "").lower()
        if amount > 0 and direction in _OUTGOING:
            amount = -amount
        account = item.get("account_id") or item.get("account")
        if isinstance(account, Mapping):
            account = _pick(account, _ID_KEYS)
        category = item.get("category")
        if not isinstance(category, (str, Mapping)):
            category = _linked(included, item.get("category_ref")) or None
        status = str(item.get("status") or "").lower()
        found.setdefault(None if account is None else str(account), []).append(
            Transaction(
                date=day,
                label=_name(_pick(item, _TRANSACTION_LABEL_KEYS)) or "?",
                amount=amount,
                currency=_currency(item) or currency or "EUR",
                pending=bool(item.get("is_pending") or item.get("pending")) or status == "pending",
                category=_name(category) or _name(item.get("category_name")),
            )
        )
    return found


def _next_cursor(payload: Any) -> str | None:
    """Where the next page of a cursor-paginated answer starts, if there is one."""
    if not isinstance(payload, Mapping):
        return None
    meta = payload.get("meta") if isinstance(payload.get("meta"), Mapping) else {}
    if meta.get("has_more") is False:
        return None
    for key in ("next_cursor", "cursor", "next"):
        if isinstance(meta.get(key), str) and meta[key]:
            return meta[key]
    if isinstance(payload.get("next_cursor"), str) and payload["next_cursor"]:
        return payload["next_cursor"]
    links = payload.get("links") if isinstance(payload.get("links"), Mapping) else {}
    if isinstance(links.get("next"), str):
        cursor = parse_qs(urlsplit(links["next"]).query).get("cursor")
        return cursor[0] if cursor else None
    return None


def _ranks(values: list[Any]) -> list[int | None]:
    """Each value's rank (1 = smallest), or None when missing: the order, not the values."""
    present = sorted(
        {v for v in values if v not in (None, "")}, key=lambda v: (not str(v).isdigit(), _sortable(v))
    )
    return [present.index(v) + 1 if v not in (None, "") else None for v in values]


def _sortable(value: Any) -> Any:
    text = str(value)
    return int(text) if text.isdigit() else text


def order_keys(payload: Any) -> dict[str, list[Any]]:
    """How Finary's lines and securities would sort by each key they carry, as ranks in the
    answer's order: to find which sorting pairs them (no ids, dates or values)."""
    data = (
        [item for item in (payload.get("data") or []) if isinstance(item, Mapping)]
        if isinstance(payload, Mapping)
        else []
    )
    lines = [_flat(item) for item in data]
    securities = list(_included(payload).items())
    return {
        "line_named": [bool(_name(_pick(line, _LABEL_KEYS))) for line in lines],
        "line_id": _ranks([item.get("id") for item in data]),
        "line_asset_id": _ranks([(line.get("asset_ref") or ("", None))[1] for line in lines]),
        "line_created_at": _ranks([line.get("created_at") for line in lines]),
        "line_updated_at": _ranks([line.get("updated_at") for line in lines]),
        "security_type": [kind for (kind, _), _ in securities],
        "security_id": _ranks([resource_id for (_, resource_id), _ in securities]),
        "security_isin": _ranks([resource.get("isin") for _, resource in securities]),
        "security_name": _ranks([resource.get("name") for _, resource in securities]),
        "security_symbol": _ranks([resource.get("symbol") for _, resource in securities]),
    }


def _id_format(value: str) -> str:
    """What an id looks like, without the id: "digits:6", "uuid", "alnum:24"..."""
    if value.isdigit():
        return f"digits:{len(value)}"
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", value, re.I):
        return "uuid"
    return f"{'alnum' if value.isalnum() else 'other'}:{len(value)}"


def _log_links(payload: Any, found: list[Holding]) -> None:
    """How holdings link to their securities: type labels, id formats and overlaps (never
    the ids or values), to read Finary's layout."""
    data = payload.get("data") if isinstance(payload, Mapping) else None
    links = [
        ((item.get("relationships") or {}).get("asset") or {}).get("data") or {}
        for item in data or []
        if isinstance(item, Mapping)
    ]
    link_ids = [str(link.get("id")) for link in links if link.get("id") is not None]
    included = _included(payload)
    security_ids = [resource_id for (kind, resource_id) in included if kind != "currencies"]
    data_ids = {str(item.get("id")) for item in data or [] if isinstance(item, Mapping)}
    named = sum(
        bool(_name(_pick(_flat(item), _LABEL_KEYS))) for item in data or [] if isinstance(item, Mapping)
    )
    log.info(
        "Finary holdings: %s of %s with ISIN, %s named; link types %s, included types %s;"
        " link ids %s, included ids %s; same ids %s, link ids equal to holding ids %s,"
        " one id inside the other %s; types %s, fees %s, entry fees %s, stated yields %s",
        sum(bool(h.isin) for h in found),
        len(found),
        named,
        sorted({str(link.get("type")) for link in links}),
        sorted({kind for kind, _ in included}),
        sorted({_id_format(i) for i in link_ids}),
        sorted({_id_format(i) for i in security_ids}),
        len(set(link_ids) & set(security_ids)),
        len(set(link_ids) & data_ids),
        sum(any(a in b or b in a for b in security_ids) for a in link_ids),
        sorted({str(h.security_type) for h in found}),
        sorted({str(h.fees) for h in found}),
        sorted({str(_flat(item).get("subscription_fees_ratio")) for item in included.values()}),
        # As Finary gives them, to check how they read (percent or fraction).
        sorted({str(_flat(item).get("annual_yield")) for item in data or [] if isinstance(item, Mapping)}),
    )


_FEE_KEYS = ("expense_ratio", "ongoing_charges", "ter", "fees")
_ENTRY_FEE_KEYS = ("subscription_fees_ratio", "entry_fees", "subscription_fees")
_SECURITY_TYPE_KEYS = ("security_type", "asset_type", "holding_type")


def _upper(value: Any) -> str | None:
    return str(value).upper() if isinstance(value, str) and value else None


def _fraction(ratio: Decimal | None) -> Decimal | None:
    """A yearly fee as a fraction. Sources give 0.2 (percent) or 0.002: no fund charges 10% a
    year, so values above 0.1 are percentages."""
    if ratio is None:
        return None
    return ratio / 100 if ratio > Decimal("0.1") else ratio


def _entry_fraction(ratio: Decimal | None) -> Decimal | None:
    """A fund's maximum entry fee as a fraction: 0.03 or 3 (percent) for 3%. No fund charges
    20% on entry, so values above 0.2 are percentages."""
    if ratio is None:
        return None
    return ratio / 100 if ratio > Decimal("0.2") else ratio


_YIELD_KEYS = ("annual_yield", "yield", "interest_rate")


def _yield(ratio: Decimal | None) -> Decimal | None:
    """A yearly yield as a fraction. Sources give 3.5 (percent) or 0.035: yields above 20%
    a year don't occur on these lines, so values above 0.2 are percentages."""
    if ratio is None:
        return None
    return ratio / 100 if abs(ratio) > Decimal("0.2") else ratio


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
        self._transactions: dict[str | None, list[Transaction]] | None = None
        # Why Finary lists no transactions, when it says: {"availability", "note"}.
        self.transactions_notice: dict[str, str] | None = None
        self._labels: dict[str, str] = {}

    def accounts(self) -> list[Account]:
        payload = self._mcp.call("accounts")
        log.info("Finary accounts answer: %s", json.dumps(shape(payload)))
        found = accounts_from(payload)
        self._labels = {account.external_id: account.label for account in found}
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
            payload = self._all_pages("holdings", {required[0]: account_id})
            if self._holdings is None:
                log.info("Finary holdings answer: %s", json.dumps(shape(payload)))
                self._holdings = {}
            found = [holding for holdings in holdings_from(payload).values() for holding in holdings]
            _log_links(payload, found)
            if any(h.match in ("order", "order_uncertain") for h in found):
                # The account's name and how each list sorts (ranks, never ids, dates or
                # amounts), to find the order that pairs lines with their securities.
                log.info(
                    "Finary holdings of %r paired by order (%s): %s",
                    self._labels.get(account_id, account_id),
                    "uncertain" if any(h.match == "order_uncertain" for h in found) else "same counts",
                    json.dumps(order_keys(payload)),
                )
            return found
        log.info("Finary holdings needs %s: not read yet", required)
        return []

    def _all_pages(self, tool: str, arguments: dict[str, Any], page_size: int = 100) -> Any:
        """A paginated tool's answer, with `data` and `included` gathered across pages."""
        data: list[Any] = []
        included: list[Any] = []
        payload: Any = {}
        for page in range(20):
            payload = self._mcp.call(tool, {**arguments, "limit": page_size, "offset": page * page_size})
            if not isinstance(payload, Mapping) or not isinstance(payload.get("data"), list):
                return payload
            data += payload["data"]
            included += payload.get("included") or []
            if not (payload.get("meta") or {}).get("has_more"):
                break
        return {**payload, "data": data, "included": included}

    def transactions(self, account_id: str, limit: int | None = None) -> list[Transaction]:
        # Finary lists transactions across accounts: they are read once, for every account,
        # over TRANSACTION_DAYS (not `limit` per account).
        if self._transactions is None:
            self._transactions = {}
            try:
                self._transactions = self._read_transactions()
            except ConnectorError as error:
                log.info("Finary transactions unavailable: %s %s", error.code, error.detail[:200])
        return self._transactions.get(account_id, [])

    def _read_transactions(self) -> dict[str | None, list[Transaction]]:
        tool = self._mcp.tools.get("list_transactions")
        if tool is None:
            return {}
        properties = (tool.get("inputSchema") or {}).get("properties") or {}
        page_size = min(100, int((properties.get("page_size") or {}).get("maximum") or 100))
        start = (date.today() - timedelta(days=TRANSACTION_DAYS)).isoformat()
        found: dict[str | None, list[Transaction]] = {}
        cursor: str | None = None
        for page in range(TRANSACTION_PAGES):
            arguments: dict[str, Any] = {"start_date": start, "end_date": date.today().isoformat()}
            arguments["page_size"] = page_size
            if cursor:
                arguments["cursor"] = cursor
            payload = self._mcp.call("list_transactions", arguments)
            if page == 0:
                log.info("Finary transactions answer: %s", json.dumps(shape(payload)))
                if isinstance(payload, Mapping) and "availability" in payload and "data" not in payload:
                    # Finary's own words on why it lists none (its plan, its budget...).
                    self.transactions_notice = {
                        "availability": str(payload.get("availability") or ""),
                        "note": str(payload.get("note") or ""),
                    }
                    log.info("Finary transactions unavailable: %s", json.dumps(self.transactions_notice))
                    return {}
            for account, transactions in transactions_from(payload).items():
                found.setdefault(account, []).extend(transactions)
            following = _next_cursor(payload)
            if not following or following == cursor:
                break
            cursor = following
        count = sum(len(t) for t in found.values())
        log.info(
            "Finary transactions: %s in %s pages, %s without account, %s with a category",
            count,
            page + 1,
            len(found.get(None, [])),
            sum(1 for ts in found.values() for t in ts if t.category),
        )
        return found

    def close(self) -> None:
        pass
