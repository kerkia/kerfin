from __future__ import annotations

import json
from decimal import Decimal

import pytest
from conftest import FINARY_ACCOUNTS, FakeFinary

from kerfin_engine.connectors import finary
from kerfin_engine.connectors.base import ConnectorError, ErrorCode
from kerfin_engine.domain import AccountKind


def test_accounts_are_read_from_varied_layouts() -> None:
    accounts = {a.external_id: a for a in finary.accounts_from(FINARY_ACCOUNTS)}

    livret, spirit, crypto = accounts["acc-1"], accounts["acc-2"], accounts["acc-3"]
    assert (livret.kind, livret.balance, livret.currency, livret.institution) == (
        AccountKind.SAVINGS,
        Decimal("22950.5"),
        "EUR",
        "BoursoBank",
    )
    assert (spirit.kind, spirit.balance, spirit.currency, spirit.institution) == (
        AccountKind.LIFE_INSURANCE,
        Decimal("48210.37"),
        "EUR",
        "Spirica",
    )
    assert crypto.kind is AccountKind.CRYPTO and crypto.balance == Decimal("1200")


@pytest.mark.parametrize(
    ("description", "kind"),
    [
        ("PEA", AccountKind.PEA),
        ("Plan d'épargne retraite (PER)", AccountKind.RETIREMENT),
        ("Compte courant", AccountKind.CHECKING),
        ("Compte-titres ordinaire (CTO)", AccountKind.SECURITIES),
        ("SCPI", AccountKind.REAL_ESTATE),
        ("Crédit immobilier", AccountKind.LOAN),
        ("something else", AccountKind.OTHER),
    ],
)
def test_account_kinds(description: str, kind: AccountKind) -> None:
    assert finary.account_kind(description) is kind


def test_shape_hides_values_and_data_like_keys() -> None:
    payload = {"accounts": [{"name": "Livret de Jean", "balance": 12.5}], "by_name": {"Livret de Jean": 1}}
    shown = json.dumps(finary.shape(payload))
    assert "Jean" not in shown and "12.5" not in shown
    assert finary.shape(payload)["accounts"] == ["1 items", {"name": "str", "balance": "float"}]


def test_connector_reads_accounts_and_holdings(fake_finary: FakeFinary) -> None:
    secrets = {
        "client_id": "client-1",
        "refresh_token": "r1",
        "token_endpoint": f"{fake_finary.base}/oauth/token",
    }
    connector = finary.FinaryConnector(secrets)

    assert connector.updated_secrets == {**secrets, "refresh_token": "r2"}
    assert [a.label for a in connector.accounts()] == ["Livret A", "Linxea Spirit 2", "Bitpanda"]
    holdings = connector.holdings("acc-2")
    assert [h.label for h in holdings] == ["Fonds euros", "MSCI World"]
    assert holdings[1].isin == "IE00B4L5Y983" and holdings[1].quantity == Decimal("41.2")
    assert connector.holdings("acc-1") == []
    assert fake_finary.calls == [
        "initialize",
        "notifications/initialized",
        "tools/list",
        "accounts",
        "holdings",
    ]


def test_expired_refresh_token_asks_to_sign_in_again(fake_finary: FakeFinary) -> None:
    secrets = {
        "client_id": "client-1",
        "refresh_token": "old",
        "token_endpoint": f"{fake_finary.base}/oauth/token",
    }
    with pytest.raises(ConnectorError) as error:
        finary.FinaryConnector(secrets)
    assert error.value.code is ErrorCode.SIGN_IN_NEEDED


def test_unknown_layout_reports_its_structure(
    fake_finary: FakeFinary, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("conftest.FINARY_ACCOUNTS", {"total": 99.5})
    secrets = {
        "client_id": "client-1",
        "refresh_token": "r1",
        "token_endpoint": f"{fake_finary.base}/oauth/token",
    }
    with pytest.raises(ConnectorError) as error:
        finary.FinaryConnector(secrets).accounts()
    assert error.value.code is ErrorCode.UNEXPECTED
    assert '{"total": "float"}' in error.value.detail and "99.5" not in error.value.detail
