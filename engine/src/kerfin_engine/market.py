"""Price histories of the securities held, and euro exchange rates, for performance analyses.

- Prices: Yahoo Finance's public quote data, found by ISIN, else by the fund's name. A
  candidate is only kept if its latest price matches the price the source (Finary)
  gives for the security, so a wrong share class is never used. Closes are adjusted for
  distributions, so performance includes them.
- Exchange rates: the ECB's daily reference rates (official, free).

Everything is fetched incrementally and kept in the vault: which securities someone holds
is personal, even though prices aren't.
"""

from __future__ import annotations

import functools
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from importlib import resources
from typing import Any

import requests

from kerfin_engine.store import Store

log = logging.getLogger(__name__)

YAHOO = "https://query2.finance.yahoo.com"
ECB = "https://data-api.ecb.europa.eu/service/data/EXR"
WIKIDATA = "https://query.wikidata.org/sparql"
TIMEOUT = 30
HISTORY_YEARS = 15
# Currencies offered for display, fetched even when no security is quoted in them.
DISPLAY_CURRENCIES = ("USD", "GBP", "CHF")
PRICE_TOLERANCE = Decimal("0.03")  # a candidate's latest price may differ by 3% (dates differ)
RECHECK_UNMATCHED_DAYS = 7
SEARCH_TYPES = {"ETF", "MUTUALFUND", "EQUITY"}


@dataclass(frozen=True)
class Candidate:
    symbol: str
    name: str
    quote_type: str
    sector: str | None = None  # company shares only


def _session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = "Kerfin (personal finance dashboard)"
    return session


class Sources:
    """The remote sources, behind one object so tests can replace them."""

    def __init__(self) -> None:
        self._session = _session()

    def search(self, query: str) -> list[Candidate]:
        response = self._session.get(
            f"{YAHOO}/v1/finance/search",
            params={"q": query, "quotesCount": 8, "newsCount": 0},
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        return [
            Candidate(
                quote["symbol"],
                quote.get("longname") or quote.get("shortname") or "",
                quote["quoteType"],
                quote.get("sector") or None,
            )
            for quote in response.json().get("quotes", [])
            if quote.get("quoteType") in SEARCH_TYPES and quote.get("symbol")
        ]

    def company_country(self, isin: str) -> str | None:
        """Where a listed company is based, from Wikidata (an open knowledge base), by ISIN."""
        if not isin.isalnum():
            return None
        query = (
            f'SELECT ?countryLabel WHERE {{ ?company wdt:P946 "{isin}"; wdt:P17 ?country.'
            ' SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 1'
        )
        response = self._session.get(WIKIDATA, params={"query": query, "format": "json"}, timeout=TIMEOUT)
        response.raise_for_status()
        bindings = response.json().get("results", {}).get("bindings", [])
        return bindings[0]["countryLabel"]["value"] if bindings else None

    def history(self, symbol: str, start: date) -> tuple[str | None, list[tuple[date, Decimal]]]:
        """(currency, daily closes adjusted for distributions) since `start`."""
        response = self._session.get(
            f"{YAHOO}/v8/finance/chart/{symbol}",
            params={
                "period1": int(datetime(start.year, start.month, start.day, tzinfo=UTC).timestamp()),
                "period2": int(datetime.now(UTC).timestamp()),
                "interval": "1d",
                "events": "div,splits",
            },
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        result = (response.json().get("chart", {}).get("result") or [{}])[0]
        indicators = result.get("indicators", {})
        closes = ((indicators.get("adjclose") or [{}])[0].get("adjclose")) or (
            (indicators.get("quote") or [{}])[0].get("close")
        )
        points = []
        for timestamp, close in zip(result.get("timestamp") or [], closes or [], strict=False):
            if close is not None:
                points.append((datetime.fromtimestamp(timestamp, UTC).date(), Decimal(str(close))))
        return result.get("meta", {}).get("currency"), points

    def rates(self, currency: str, start: date) -> list[tuple[date, Decimal]]:
        """ECB reference rates: units of `currency` for one euro."""
        response = self._session.get(
            f"{ECB}/D.{currency}.EUR.SP00.A",
            params={"format": "csvdata", "startPeriod": start.isoformat()},
            timeout=TIMEOUT,
        )
        if response.status_code == 404:  # no rate published since `start`
            return []
        response.raise_for_status()
        lines = response.text.splitlines()
        if not lines:
            return []
        header = lines[0].split(",")
        day, value = header.index("TIME_PERIOD"), header.index("OBS_VALUE")
        points = []
        for line in lines[1:]:
            cells = line.split(",")
            try:
                points.append((date.fromisoformat(cells[day]), Decimal(cells[value])))
            except (IndexError, ValueError, InvalidOperation):
                continue
        return points


def _converted(
    price: Decimal, from_currency: str | None, to_currency: str | None, rate: Callable[[str], Decimal | None]
) -> Decimal | None:
    """`price` from one currency to another through today's euro rates (None if unknown)."""
    if not from_currency or not to_currency or from_currency == to_currency:
        return price
    # Pence: LSE prices are often in GBp.
    if from_currency == "GBp":
        price, from_currency = price / 100, "GBP"
        if from_currency == to_currency:
            return price
    source = Decimal(1) if from_currency == "EUR" else rate(from_currency)
    target = Decimal(1) if to_currency == "EUR" else rate(to_currency)
    if not source or not target:
        return None
    return price / source * target


class MarketData:
    def __init__(self, store: Store, sources: Sources | None = None) -> None:
        self._store = store
        self._sources = sources or Sources()
        self._latest_rates: dict[str, Decimal] = {}

    def refresh(self, today: date | None = None) -> dict[str, int]:
        """Updates exchange rates, then each held security's price history."""
        today = today or date.today()
        securities = self._held_securities()
        currencies = {s["unit_value_currency"] for s in securities if s["unit_value_currency"]}
        for currency in sorted((currencies | set(DISPLAY_CURRENCIES)) - {"EUR", "GBp"}):
            self._refresh_rates(currency, today)
        matched = 0
        for security in securities:
            try:
                if self._refresh_security(security, today):
                    matched += 1
            except (requests.RequestException, ValueError, KeyError) as error:
                log.warning("Prices of one security failed: %s", type(error).__name__)
        log.info("Market data: %s of %s securities have prices", matched, len(securities))
        return {"securities": len(securities), "with_prices": matched}

    def _held_securities(self) -> list[dict[str, Any]]:
        """One row per ISIN held, with the latest price the source gave for it."""
        by_isin: dict[str, dict[str, Any]] = {}
        for holding in self._store.holdings():
            if holding["isin"] and holding["isin"] not in by_isin:
                by_isin[holding["isin"]] = holding
        return list(by_isin.values())

    def _refresh_rates(self, currency: str, today: date) -> None:
        last = self._store.last_rate_date(currency)
        start = (
            date.fromisoformat(last) + timedelta(days=1)
            if last
            else today.replace(year=today.year - HISTORY_YEARS)
        )
        if start <= today:
            try:
                points = self._sources.rates(currency, start)
            except requests.RequestException as error:
                log.warning("ECB rates for %s failed: %s", currency, type(error).__name__)
                points = []
            self._store.save_rates(currency, points)
        latest = self._store.market()["fx"].get(currency)
        if latest:
            self._latest_rates[currency] = Decimal(latest[-1][1])

    def _refresh_security(self, holding: dict[str, Any], today: date) -> bool:
        isin = holding["isin"]
        known = self._store.security(isin)
        if known is None or (
            known["symbol"] is None
            and datetime.fromisoformat(known["checked_at"])
            < datetime.now(UTC) - timedelta(days=RECHECK_UNMATCHED_DAYS)
        ):
            candidate, currency = self._resolve(holding, today)
            country = None
            if candidate and candidate.quote_type == "EQUITY":
                try:
                    country = self._sources.company_country(isin)
                except (requests.RequestException, ValueError, KeyError) as error:
                    log.warning("Wikidata lookup failed: %s", type(error).__name__)
            self._store.save_security(
                isin,
                candidate.symbol if candidate else None,
                currency,
                candidate.quote_type if candidate else None,
                candidate.sector if candidate else None,
                country,
            )
            known = self._store.security(isin)
        if not known or not known["symbol"]:
            return False
        last = self._store.last_price_date(isin)
        start = (
            date.fromisoformat(last) + timedelta(days=1)
            if last
            else today.replace(year=today.year - HISTORY_YEARS)
        )
        if start <= today:
            _, points = self._sources.history(known["symbol"], start)
            self._store.save_prices(isin, points)
        return True

    def _resolve(self, holding: dict[str, Any], today: date) -> tuple[Candidate | None, str | None]:
        """The candidate whose latest price matches the source's price for this security."""
        reference = _decimal(holding["unit_value"])
        reference_currency = holding["unit_value_currency"] or holding["currency"]
        candidates = self._sources.search(holding["isin"])
        by_isin = {c.symbol for c in candidates}
        if holding["label"]:
            candidates += [c for c in self._sources.search(holding["label"]) if c.symbol not in by_isin]
        for candidate in candidates[:10]:
            currency, points = self._sources.history(candidate.symbol, today - timedelta(days=10))
            if not points:
                continue
            if reference is None:
                # Nothing to check against: trust only a match on the ISIN itself.
                if candidate.symbol in by_isin:
                    return candidate, currency
                continue
            latest = _converted(points[-1][1], currency, reference_currency, self._latest_rates.get)
            if latest is not None and abs(latest / reference - 1) <= PRICE_TOLERANCE:
                return candidate, currency
        return None, None


def _decimal(value: Any) -> Decimal | None:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None
    return number if number > 0 else None


@functools.cache
def index_profiles() -> list[dict[str, Any]]:
    """Country and sector weights of the main indices (refreshed from MSCI at each release)."""
    data = resources.files("kerfin_engine").joinpath("data/index_profiles.json").read_text(encoding="utf-8")
    return json.loads(data)["indices"]
