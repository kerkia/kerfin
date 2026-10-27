"""Catalogue of supported institutions and the connector that collects each one's data."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import StrEnum


class ConnectorType(StrEnum):
    WOOB = "woob"
    ENABLE_BANKING = "enable_banking"
    BITPANDA = "bitpanda"
    NEXO = "nexo"
    TRADE_REPUBLIC = "trade_republic"
    ONCHAIN = "onchain"
    MANUAL = "manual"
    DEMO = "demo"


@dataclass(frozen=True)
class Institution:
    id: str
    name: str
    products: str  # what this connection covers, for display
    connector: ConnectorType
    # Connector settings that are the same for every user (e.g. the Woob module and broker).
    settings: dict[str, str] = field(default_factory=dict)
    implemented: bool = False


CATALOG: tuple[Institution, ...] = (
    Institution(
        "spirica",
        "Spirica (Linxea)",
        "Linxea Spirit, Linxea Spirit 2, Linxea Spirit PER",
        ConnectorType.WOOB,
        {"module": "spirica"},
        implemented=True,
    ),
    Institution(
        "suravenir-linxea",
        "Suravenir (Linxea)",
        "Linxea Avenir",
        ConnectorType.WOOB,
        {"module": "suravenir", "broker": "linxea"},
        implemented=True,
    ),
    Institution(
        "boursobank",
        "BoursoBank",
        "Livret A, LDD, Matla PER (to confirm)",
        ConnectorType.WOOB,
        {"module": "boursorama"},
        implemented=True,
    ),
    Institution(
        "boursedirect",
        "Bourse Direct",
        "PEA, CTO",
        ConnectorType.WOOB,
        {"module": "boursedirect"},
        implemented=True,
    ),
    Institution(
        "swisslife",
        "Swiss Life (Placement-direct)",
        "Darjeeling, PER Placement-direct",
        ConnectorType.WOOB,
        {"module": "swisslife"},
        implemented=True,
    ),
    Institution(
        "abeille",
        "Abeille Assurances (assurancevie.com)",
        "Evolution Vie",
        ConnectorType.WOOB,
        {"module": "abeilleassurances"},
        implemented=True,
    ),
    Institution(
        "apicil",
        "APICIL (Ramify)",
        "Ramify assurance-vie, Ramify PER",
        ConnectorType.WOOB,
        {"module": "apivie"},
        implemented=True,
    ),
    Institution(
        "wiseed", "WiSEED", "Crowdfunding", ConnectorType.WOOB, {"module": "wiseed"}, implemented=True
    ),
    Institution("revolut", "Revolut", "Current account", ConnectorType.ENABLE_BANKING),
    Institution("trade-republic", "Trade Republic", "Securities, cash", ConnectorType.TRADE_REPUBLIC),
    Institution("bitpanda", "Bitpanda", "Crypto", ConnectorType.BITPANDA),
    Institution("nexo", "Nexo", "Crypto", ConnectorType.NEXO),
    Institution("ledger", "Ledger Nano X", "Crypto wallets (public addresses only)", ConnectorType.ONCHAIN),
    Institution("gmx", "GMX", "On-chain positions (wallet address only)", ConnectorType.ONCHAIN),
    Institution("luxavie", "Baloise Luxembourg", "Luxavie", ConnectorType.MANUAL),
    Institution("anaxago", "Anaxago", "Crowdfunding", ConnectorType.MANUAL),
    Institution("neverless", "Neverless", "Crypto", ConnectorType.MANUAL),
)


DEMO = Institution(
    "demo", "Demo Bank", "Made-up accounts to try Kerfin", ConnectorType.DEMO, implemented=True
)


def catalog() -> tuple[Institution, ...]:
    """The institutions offered to the user; the demo one only when KERFIN_DEMO=1."""
    return (*CATALOG, DEMO) if os.environ.get("KERFIN_DEMO") == "1" else CATALOG


def get(institution_id: str) -> Institution:
    for institution in catalog():
        if institution.id == institution_id:
            return institution
    raise KeyError(institution_id)
