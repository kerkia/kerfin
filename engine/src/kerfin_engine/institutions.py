"""Catalogue of supported institutions and the connector that collects each one's data.

The catalogue is a hand-written list (institutions with a tailored name or settings, and
those waiting for a connector), followed by every other Woob module that reads bank or
investment accounts.
"""

from __future__ import annotations

import functools
import json
import logging
import os
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from kerfin_engine import paths, woob_modules

log = logging.getLogger(__name__)


class ConnectorType(StrEnum):
    FINARY = "finary"
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
        "Bank accounts, savings, life insurance, PEA, securities",
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


FINARY = Institution(
    "finary",
    "Finary",
    "Everything you have linked in Finary: banks, insurers, brokers, crypto",
    ConnectorType.FINARY,
    implemented=True,
)

DEMO = Institution(
    "demo", "Demo Bank", "Made-up accounts to try Kerfin", ConnectorType.DEMO, implemented=True
)


WOOB_CATALOG_FILE = "kerfin-catalog.json"

# Woob modules left out of the catalogue: superseded by another module, or not about money.
_WOOB_SKIPPED = {"barclays", "roblox"}

# Better names than the modules' own descriptions.
_WOOB_NAMES = {
    "afer": "AFER",
    "binance": "Binance",
    "degiro": "DEGIRO",
    "helios": "Helios",
    "kraken": "Kraken",
    "lita": "Lita",
    "n26": "N26",
    "suravenir": "Suravenir (assurancevie.com, Linxea, other brokers)",
}


def write_woob_catalog(modules_dir: Path) -> list[dict[str, Any]]:
    """Lists the installed Woob modules that serve institutions, and saves the list beside them."""
    from kerfin_engine.connectors.woob_connector import bank_modules

    modules = bank_modules(modules_dir)
    data = {"commit": woob_modules.installed_commit(modules_dir), "modules": modules}
    (modules_dir / WOOB_CATALOG_FILE).write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return modules


@functools.cache
def _woob_catalog() -> tuple[Institution, ...]:
    modules_dir = paths.woob_modules_dir()
    try:
        data = json.loads((modules_dir / WOOB_CATALOG_FILE).read_text(encoding="utf-8"))
        if data["commit"] != woob_modules.installed_commit(modules_dir):
            raise ValueError("catalogue of other modules")
        modules = data["modules"]
    except (OSError, ValueError, KeyError):
        # Modules installed before the catalogue file existed: build it once (a few seconds).
        try:
            modules = write_woob_catalog(modules_dir)
        except Exception:
            log.exception("Listing the Woob modules failed")
            return ()

    covered = {
        institution.settings["module"]
        for institution in CATALOG
        if institution.connector is ConnectorType.WOOB and set(institution.settings) == {"module"}
    }
    return tuple(
        Institution(
            module["module"],
            _WOOB_NAMES.get(module["module"], module["name"]),
            "Accounts and investments" if module["investments"] else "Accounts",
            ConnectorType.WOOB,
            {"module": module["module"]},
            implemented=True,
        )
        for module in modules
        if module["module"] not in covered | _WOOB_SKIPPED
    )


def catalog() -> tuple[Institution, ...]:
    """The institutions offered to the user; the demo one only when KERFIN_DEMO=1.

    Finary collects every account: logging in to each website (Woob) proved too fragile,
    so those institutions are no longer offered. Existing connections to them still work.
    """
    return (FINARY, DEMO) if os.environ.get("KERFIN_DEMO") == "1" else (FINARY,)


def known() -> tuple[Institution, ...]:
    """Every institution Kerfin can connect to, offered or not."""
    return (*catalog(), *CATALOG, *_woob_catalog())


def get(institution_id: str) -> Institution:
    for institution in known():
        if institution.id == institution_id:
            return institution
    raise KeyError(institution_id)
