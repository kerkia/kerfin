from __future__ import annotations

import json
from decimal import Decimal

import pytest
from conftest import FINARY_ACCOUNTS, FakeFinary

from kerfin_engine.connectors import finary
from kerfin_engine.connectors.base import ConnectorError, ErrorCode
from kerfin_engine.domain import AccountKind


def test_finary_accounts_are_read_with_owned_value_and_institution() -> None:
    accounts = {a.external_id: a for a in finary.accounts_from(FINARY_ACCOUNTS)}

    livret, spirit, crypto = accounts["acc-1"], accounts["acc-2"], accounts["acc-3"]
    assert (livret.label, livret.kind, livret.balance, livret.currency, livret.institution) == (
        "Livret A",
        AccountKind.SAVINGS,
        Decimal("11475.25"),
        "EUR",
        "BoursoBank",
    )
    assert (spirit.kind, spirit.institution, spirit.subtype) == (
        AccountKind.LIFE_INSURANCE,
        "Spirica",
        "investment",  # Finary's type; the insurer says what it is
    )
    assert crypto.kind is AccountKind.CRYPTO and crypto.institution is None


def test_accounts_are_read_from_other_layouts() -> None:
    payload = {
        "accounts": [
            {
                "id": "1",
                "name": "PEA",
                "category": "pea",
                "bank": {"name": "Bourse Direct"},
                "balance": {"value": 9.5},
            },
            {
                "id": "2",
                "label": "CTO",
                "type": "securities",
                "current_value": "12",
                "currency": {"code": "usd"},
            },
        ]
    }
    pea, cto = finary.accounts_from(payload)
    assert (pea.kind, pea.balance, pea.currency, pea.institution) == (
        AccountKind.PEA,
        Decimal("9.5"),
        "EUR",
        "Bourse Direct",
    )
    assert (cto.kind, cto.balance, cto.currency) == (AccountKind.SECURITIES, Decimal("12"), "USD")


@pytest.mark.parametrize(
    ("description", "kind"),
    [
        ("PEA", AccountKind.PEA),
        ("Plan d'épargne retraite (PER)", AccountKind.RETIREMENT),
        ("Compte courant", AccountKind.CHECKING),
        ("Compte-titres ordinaire (CTO)", AccountKind.SECURITIES),
        ("SCPI", AccountKind.REAL_ESTATE),
        ("Lucya Cardif PER", AccountKind.RETIREMENT),
        ("Carte Visa Premier", AccountKind.CARD),
        ("Crédit immobilier", AccountKind.LOAN),
        ("something else", AccountKind.OTHER),
    ],
)
def test_account_kinds(description: str, kind: AccountKind) -> None:
    assert finary.account_kind(description) is kind


def test_shape_shows_each_resource_type() -> None:
    included = finary.shape(FINARY_ACCOUNTS)["included"]
    assert included[0] == "4 items" and len(included) == 3  # institution_connection, institution


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
    assert connector.accounts()[1].institution == "Spirica"
    assert fake_finary.calls[:5] == [
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
    monkeypatch.setattr("conftest.FINARY_ACCOUNTS", {"summary": {"net": 99.5}})
    secrets = {
        "client_id": "client-1",
        "refresh_token": "r1",
        "token_endpoint": f"{fake_finary.base}/oauth/token",
    }
    with pytest.raises(ConnectorError) as error:
        finary.FinaryConnector(secrets).accounts()
    assert error.value.code is ErrorCode.UNEXPECTED
    assert '{"summary": {"net": "float"}}' in error.value.detail and "99.5" not in error.value.detail


@pytest.mark.parametrize(
    ("name", "institution_kind", "kind"),
    [
        ("PEA Bourse", "bank", AccountKind.PEA),
        ("Compte-titres", "bank", AccountKind.SECURITIES),
        ("Linxea Avenir", "insurer", AccountKind.LIFE_INSURANCE),
        ("Mon PER", "insurer", AccountKind.RETIREMENT),
    ],
)
def test_investment_accounts_get_their_kind_from_name_or_institution(
    name: str, institution_kind: str, kind: AccountKind
) -> None:
    payload = {
        "data": [
            {
                "id": "a",
                "type": "account",
                "attributes": {"name": name, "account_type": "investment", "balance": "1"},
                "relationships": {"institution_connection": {"data": {"type": "conn", "id": "c"}}},
            }
        ],
        "included": [
            {
                "id": "c",
                "type": "conn",
                "relationships": {"institution": {"data": {"type": "inst", "id": "i"}}},
            },
            {"id": "i", "type": "inst", "attributes": {"name": "X", "kind": institution_kind}},
        ],
    }
    [account] = finary.accounts_from(payload)
    assert account.kind is kind and account.institution == "X"


def test_holdings_take_isin_and_price_from_the_linked_security() -> None:
    # Shaped like Finary's holdings answer (2026-10-28); the values are made up.
    payload = {
        "data": [
            {
                "id": "h1",
                "type": "holdings",
                "attributes": {
                    "name": "MSCI World",
                    "current_value": "1520.40",
                    "current_value_currency": "EUR",
                },
                "relationships": {"asset": {"data": {"type": "securities", "id": "s1"}}},
            }
        ],
        "included": [
            {
                "id": "s1",
                "type": "securities",
                "attributes": {
                    "isin": "IE00B4L5Y983",
                    "name": "iShares Core MSCI World",
                    "current_price": "98.12",
                },
            }
        ],
        "meta": {"total": 1, "limit": 100, "offset": 0, "has_more": False},
    }
    [holding] = [h for hs in finary.holdings_from(payload).values() for h in hs]
    assert (holding.label, holding.isin, holding.valuation, holding.unit_value) == (
        "MSCI World",
        "IE00B4L5Y983",
        Decimal("1520.40"),
        Decimal("98.12"),
    )


def test_known_insurance_contracts_are_life_insurance() -> None:
    payload = {
        "data": [
            {
                "id": "a",
                "type": "account",
                "attributes": {"name": "Linxea Spirit 2", "account_type": "investment", "balance": "1"},
            }
        ]
    }
    [account] = finary.accounts_from(payload)
    assert account.kind is AccountKind.LIFE_INSURANCE


def test_holdings_follow_links_whose_type_differs_from_the_resource() -> None:
    payload = {
        "data": [
            {
                "id": "h1",
                "type": "holdings",
                "attributes": {"name": "", "current_value": "1520.40", "current_value_currency": "EUR"},
                "relationships": {"asset": {"data": {"type": "assets", "id": "42"}}},
            }
        ],
        "included": [
            {
                "id": "42",
                "type": "securities",
                "attributes": {
                    "isin": "IE00B4L5Y983",
                    "name": "iShares Core MSCI World",
                    "security_type": "etf",
                    "current_price": "98.12",
                    "current_price_currency_code": "usd",
                    "expense_ratio": "0.2",
                },
            }
        ],
    }
    [holding] = [h for hs in finary.holdings_from(payload).values() for h in hs]
    assert (holding.label, holding.isin, holding.security_type, holding.unit_value_currency) == (
        "iShares Core MSCI World",
        "IE00B4L5Y983",
        "etf",
        "USD",
    )
    assert holding.fees == Decimal("0.002")  # 0.2 means 0.2%


def test_link_diagnostics_show_formats_but_no_ids(caplog: pytest.LogCaptureFixture) -> None:
    payload = {
        "data": [
            {
                "id": "901",
                "type": "holdings",
                "attributes": {"name": "", "current_value": "10"},
                "relationships": {"asset": {"data": {"type": "assets", "id": "123456"}}},
            }
        ],
        "included": [{"id": "777777", "type": "securities", "attributes": {"isin": "IE00B4L5Y983"}}],
    }
    found = [h for hs in finary.holdings_from(payload).values() for h in hs]
    with caplog.at_level("INFO"):
        finary._log_links(payload, found)
    line = caplog.messages[-1]
    assert "link ids ['digits:6'], included ids ['digits:6']; same ids 0" in line
    assert "123456" not in line and "777777" not in line and "IE00B4L5Y983" not in line
