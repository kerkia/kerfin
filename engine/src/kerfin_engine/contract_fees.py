"""The published yearly management fees of well-known French life insurance and PER contracts.

Finary doesn't give a contract's fees, and they matter as much as the funds' own charges.
Brokers publish them on their product pages; data/contract_fees.json lists them with their
source and date. These suggestions are only defaults: the user can set their own rate.
"""

from __future__ import annotations

import functools
import json
import unicodedata
from importlib import resources
from typing import Any

from kerfin_engine.domain import AccountKind


def _plain(text: str) -> str:
    """Lowercase, without accents or punctuation, single-spaced: names compare loosely."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    letters = "".join(c if c.isalnum() else " " for c in decomposed if not unicodedata.combining(c))
    return " ".join(letters.split())


@functools.cache
def _contracts() -> list[dict[str, Any]]:
    data = resources.files("kerfin_engine").joinpath("data/contract_fees.json").read_text(encoding="utf-8")
    return json.loads(data)["contracts"]


def suggest(contract_name: str | None, kind: str | None) -> dict[str, str | None] | None:
    """The published fees of the contract an account is named after, for its kind
    (assurance-vie or PER), as fractions: {contract, uc, euro, source}. None if unknown."""
    if kind not in (AccountKind.LIFE_INSURANCE, AccountKind.RETIREMENT):
        return None
    name = f" {_plain(contract_name or '')} "
    best: tuple[int, dict[str, Any]] | None = None
    for contract in _contracts():
        if contract["kind"] != kind:
            continue
        for alias in [contract["name"], *contract.get("aliases", [])]:
            plain = _plain(alias)
            # The longest name found wins: "Linxea Spirit PER" over "Linxea Spirit".
            if plain and f" {plain} " in name and (best is None or len(plain) > best[0]):
                best = (len(plain), contract)
    if best is None:
        return None
    contract = best[1]
    return {
        "contract": contract["name"],
        "uc": _fraction(contract["uc_fee"]),
        "euro": None if contract.get("euro_fee") is None else _fraction(contract["euro_fee"]),
        "source": contract["source"],
    }


def _fraction(percent: float | int | str) -> str:
    return str(round(float(percent) / 100, 6))
