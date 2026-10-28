"""A fake institution with made-up data, to try the app and test it without a real login.

Only listed when KERFIN_DEMO=1. It asks for an SMS code like a real bank would (any
6 digits work); the password "wrong" fails the login, and the password "qr" shows a QR
code to scan instead of asking for an SMS code.
"""

from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

from kerfin_engine.connectors.base import ConnectorError, ErrorCode, InteractionHandler, Prompt
from kerfin_engine.domain import Account, AccountKind, Holding, Transaction

FIELDS = (
    Prompt(key="login", label="Login (any)"),
    Prompt(key="password", label='Password ("wrong" fails, "qr" shows a QR code)', secret=True),
)

QR_SECONDS = 6

_ACCOUNTS = (
    Account("1", "Livret A", AccountKind.SAVINGS, Decimal("22950.00"), "EUR", "LIVRET_A"),
    Account("2", "LDD", AccountKind.SAVINGS, Decimal("12000.00"), "EUR", "LDDS"),
    Account("3", "Assurance-vie Horizon", AccountKind.LIFE_INSURANCE, Decimal("48210.37"), "EUR"),
    Account("4", "PER Demo", AccountKind.RETIREMENT, Decimal("15873.12"), "EUR", "PER"),
    Account("5", "PEA", AccountKind.PEA, Decimal("31544.80"), "EUR", "PEA"),
)

_HOLDINGS = {
    "3": [
        Holding("Fonds euros", Decimal("28000.00"), "EUR"),
        Holding("MSCI World ETF", Decimal("20210.37"), "EUR", isin="FR0000000001", quantity=Decimal("41.2")),
    ],
    "5": [Holding("S&P 500 ETF", Decimal("31544.80"), "EUR", isin="FR0000000002", quantity=Decimal("812"))],
}


class DemoConnector:
    def __init__(self, params: dict[str, str], interaction: InteractionHandler | None) -> None:
        if params.get("password") == "wrong":
            raise ConnectorError(ErrorCode.INVALID_CREDENTIALS, "Demo: wrong password")
        if interaction is None:
            raise ConnectorError(ErrorCode.INTERACTION_REQUIRED, "Demo: SMS code needed")
        if params.get("password") == "qr":
            interaction.notify("Demo bank: validate in the app. It goes through on its own in a few seconds.")
            interaction.show_qr_code("https://example.com/kerfin-demo-validation")
            time.sleep(QR_SECONDS)
            interaction.show_qr_code(None)
            return
        interaction.notify('Demo bank: a code was "sent" by SMS. Any 6 digits work.')
        interaction.ask(Prompt(key="otp_sms", label="SMS code", pattern=r"^\d{6}$"))

    def accounts(self) -> list[Account]:
        return list(_ACCOUNTS)

    def holdings(self, account_id: str) -> list[Holding]:
        return _HOLDINGS.get(account_id, [])

    def transactions(self, account_id: str, limit: int | None = None) -> list[Transaction]:
        today = date.today()
        if account_id != "1":
            return []
        items = [
            Transaction(today - timedelta(days=30 * n), "Monthly transfer", Decimal("200"), "EUR")
            for n in range(6)
        ]
        return items[:limit]

    def close(self) -> None:
        pass
