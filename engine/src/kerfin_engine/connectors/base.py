"""Contract shared by all connectors (Woob, PSD2 APIs, exchanges, on-chain, manual)."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from kerfin_engine.domain import Account, Holding, Transaction


class ErrorCode(StrEnum):
    """Stable error codes; the UI translates them, so never rely on the detail text."""

    INVALID_CREDENTIALS = "invalid_credentials"
    SIGN_IN_NEEDED = "sign_in_needed"  # e.g. Finary's access expired or was revoked: sign in again
    ACTION_NEEDED = "action_needed"  # e.g. expired password or terms to accept on the website
    INTERACTION_REQUIRED = "interaction_required"  # a login challenge while running unattended
    VALIDATION_FAILED = "validation_failed"  # app/SMS validation refused or expired
    CAPTCHA = "captcha"
    BLOCKED = "blocked"
    SITE_UNAVAILABLE = "site_unavailable"
    # No connection to the website at all (refused, cut or timed out), e.g. a firewall, security
    # software or the site's bot protection dropping it.
    CONNECTION_FAILED = "connection_failed"
    # The website's certificate could not be verified: the network may be intercepting traffic.
    INSECURE_CONNECTION = "insecure_connection"
    NOT_SUPPORTED = "not_supported"
    CONNECTOR_UNAVAILABLE = "connector_unavailable"
    INVALID_INPUT = "invalid_input"
    UNEXPECTED = "unexpected"


class ConnectorError(Exception):
    def __init__(self, code: ErrorCode, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class Prompt:
    """A value the user must provide: a login field, an SMS code, a choice..."""

    key: str
    label: str
    secret: bool = False
    choices: tuple[str, ...] = ()
    default: str | None = None
    required: bool = True
    pattern: str | None = None  # regular expression the answer must match


class InteractionHandler(Protocol):
    """How a connector reaches the user during a login (terminal now, desktop UI later)."""

    def ask(self, prompt: Prompt) -> str: ...

    def notify(self, message: str) -> None: ...

    def show_qr_code(self, data: str | None) -> None:
        """Shows a code for the user to scan with their phone app; None hides it."""
        ...


class Connector(Protocol):
    def accounts(self) -> list[Account]: ...

    def holdings(self, account_id: str) -> list[Holding]: ...

    def transactions(self, account_id: str, limit: int | None = None) -> list[Transaction]: ...

    def close(self) -> None: ...
