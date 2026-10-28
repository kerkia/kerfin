"""The insurer behind well-known French life insurance and PER contracts.

Aggregators name the broker (Linxea, assurancevie.com...) rather than the insurer that
holds the money (Spirica, Suravenir...), yet the insurer is what matters for the
guarantee of funds. These suggestions are only defaults: the user can correct them.
"""

from __future__ import annotations

import re

# (pattern on the contract's name, insurer). The first match wins: specific names first.
_KNOWN: tuple[tuple[str, str], ...] = (
    (r"suravenir", "Suravenir"),
    (r"spirica", "Spirica"),
    (r"cardif", "BNP Paribas Cardif"),
    (r"abeille|\bafer\b|evolution vie", "Abeille Vie"),
    (r"generali", "Generali Vie"),
    (r"apicil|ramify", "APICIL"),
    (r"swiss ?life|darjeeling|placement[- ]direct", "Swiss Life"),
    (r"linxea spirit", "Spirica"),
    (r"linxea avenir", "Suravenir"),
    (r"fortuneo vie|yomoni", "Suravenir"),
    (r"boursorama vie|boursobank vie|\bnalo\b", "Generali Vie"),
)


def suggest(contract_name: str | None) -> str | None:
    """The insurer of a contract known by its name, or None."""
    name = (contract_name or "").lower()
    for pattern, insurer in _KNOWN:
        if re.search(pattern, name):
            return insurer
    return None
