from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from kerfin_engine.domain import Account, AccountKind, Holding
from kerfin_engine.market import Candidate, MarketData
from kerfin_engine.store import Store

TODAY = date(2026, 10, 28)


class FakeSources:
    """Yahoo, the ECB and Wikidata, as far as MarketData uses them."""

    def __init__(self) -> None:
        self.searches: list[str] = []
        self.history_calls: list[tuple[str, date]] = []
        self.quotes = {
            # Two share classes of the same fund: only the second matches the reference price.
            "FUND-A": ("EUR", Decimal("80")),
            "FUND-B": ("EUR", Decimal("101")),
            "IWDA.L": ("USD", Decimal("110")),  # an ETF quoted in dollars
            "AAPL": ("USD", Decimal("250")),
        }

    def search(self, query: str) -> list[Candidate]:
        self.searches.append(query)
        return {
            "FR0000000001": [],
            "Some Fund A": [
                Candidate("FUND-A", "Some Fund A", "MUTUALFUND"),
                Candidate("FUND-B", "Some Fund F", "MUTUALFUND"),
            ],
            "IE00B4L5Y983": [Candidate("IWDA.L", "iShares Core MSCI World", "ETF")],
            "US0378331005": [Candidate("AAPL", "Apple Inc.", "EQUITY", "Technology", "Consumer Electronics")],
        }.get(query, [])

    def dividends(self, symbol: str, start: date) -> list[tuple[date, Decimal]]:
        return [(TODAY - timedelta(days=100), Decimal("0.5"))] if symbol == "AAPL" else []

    def instrument_code(self, isin: str) -> str | None:
        return {"US0378331005": "ESVUFR", "IE00B4L5Y983": "CEOGES"}.get(isin)

    def history(self, symbol: str, start: date) -> tuple[str, list[tuple[date, Decimal]]]:
        self.history_calls.append((symbol, start))
        currency, last = self.quotes[symbol]
        days = min((TODAY - start).days, 30)
        return currency, [(TODAY - timedelta(days=n), last - n) for n in range(days, -1, -1)]

    def rates(self, currency: str, start: date) -> list[tuple[date, Decimal]]:
        return [(TODAY, {"USD": Decimal("1.10"), "GBP": Decimal("0.85"), "CHF": Decimal("0.95")}[currency])]

    def company_country(self, isin: str) -> str | None:
        return "United States" if isin == "US0378331005" else None


def store_with(*holdings: Holding) -> Store:
    store = Store.create()
    connection = store.add_connection("finary", "Finary", {}, {}, remember=True)
    account = Account("a", "PEA", AccountKind.PEA, Decimal("1000"), "EUR")
    store.save_sync(connection, [(account, list(holdings), [])], today=TODAY)
    return store


def test_the_share_class_whose_price_matches_is_chosen() -> None:
    sources = FakeSources()
    store = store_with(
        Holding("Some Fund A", Decimal("500"), "EUR", isin="FR0000000001", unit_value=Decimal("100"))
    )

    assert MarketData(store, sources).refresh(TODAY) == {"securities": 1, "with_prices": 1}  # type: ignore[arg-type]

    assert store.security("FR0000000001")["symbol"] == "FUND-B"
    assert sources.searches == ["FR0000000001", "Some Fund A"]


def test_prices_in_another_currency_are_compared_in_euros() -> None:
    sources = FakeSources()
    # 110 USD at 1.10 USD per euro is 100 EUR.
    holding = Holding(
        "MSCI World",
        Decimal("1000"),
        "EUR",
        isin="IE00B4L5Y983",
        unit_value=Decimal("100"),
        unit_value_currency="EUR",
    )
    store = store_with(holding)
    MarketData(store, sources).refresh(TODAY)  # type: ignore[arg-type]

    assert store.security("IE00B4L5Y983")["symbol"] == "IWDA.L"
    market = store.market()
    assert market["prices"]["IE00B4L5Y983"][-1] == [TODAY.isoformat(), "110"]
    assert set(market["fx"]) == {"USD", "GBP", "CHF"}


def test_unmatched_securities_get_no_prices() -> None:
    sources = FakeSources()
    holding = Holding("Some Fund A", Decimal("500"), "EUR", isin="FR0000000001", unit_value=Decimal("50"))
    store = store_with(holding)
    assert MarketData(store, sources).refresh(TODAY)["with_prices"] == 0  # type: ignore[arg-type]
    assert store.security("FR0000000001")["symbol"] is None and "FR0000000001" not in store.market()["prices"]


def test_prices_are_fetched_incrementally() -> None:
    sources = FakeSources()
    store = store_with(
        Holding("Apple", Decimal("500"), "EUR", isin="US0378331005", unit_value=Decimal("227.27"))
    )
    market = MarketData(store, sources)  # type: ignore[arg-type]
    market.refresh(TODAY)
    sources.history_calls.clear()
    market.refresh(TODAY + timedelta(days=1))
    assert sources.history_calls == [("AAPL", TODAY + timedelta(days=1))]


def test_company_shares_get_their_sector_and_country() -> None:
    store = store_with(
        Holding("Apple", Decimal("500"), "EUR", isin="US0378331005", unit_value=Decimal("227.27"))
    )
    MarketData(store, FakeSources()).refresh(TODAY)  # type: ignore[arg-type]
    security = store.security("US0378331005")
    assert (security["quote_type"], security["sector"], security["country"]) == (
        "EQUITY",
        "Technology",
        "United States",
    )
    assert (security["industry"], security["cfi"]) == ("Consumer Electronics", "ESVUFR")


def test_distributions_are_kept_per_unit() -> None:
    store = store_with(
        Holding("Apple", Decimal("500"), "EUR", isin="US0378331005", unit_value=Decimal("227.27"))
    )
    MarketData(store, FakeSources()).refresh(TODAY)  # type: ignore[arg-type]
    MarketData(store, FakeSources()).refresh(TODAY)  # type: ignore[arg-type]
    assert store.market()["dividends"] == {
        "US0378331005": [[(TODAY - timedelta(days=100)).isoformat(), "0.5"]]
    }


def test_funds_get_their_register_code_even_without_prices() -> None:
    store = store_with(
        Holding("MSCI World", Decimal("1000"), "EUR", isin="IE00B4L5Y983", unit_value=Decimal("100")),
        Holding("Some Fund A", Decimal("500"), "EUR", isin="FR0000000001", unit_value=Decimal("50")),
    )
    MarketData(store, FakeSources()).refresh(TODAY)  # type: ignore[arg-type]
    assert store.security("IE00B4L5Y983")["cfi"] == "CEOGES"
    # Not in the register: marked as looked up, so it isn't asked again at every refresh.
    unlisted = store.security("FR0000000001")
    assert unlisted["cfi"] == "" and unlisted["classified_at"] is not None


def test_classification_survives_a_new_price_match() -> None:
    store = store_with(
        Holding("Apple", Decimal("500"), "EUR", isin="US0378331005", unit_value=Decimal("227.27"))
    )
    MarketData(store, FakeSources()).refresh(TODAY)  # type: ignore[arg-type]
    store.save_security("US0378331005", "AAPL", "USD", "EQUITY", "Technology", "United States")
    assert store.security("US0378331005")["industry"] == "Consumer Electronics"
