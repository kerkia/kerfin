from __future__ import annotations

import pytest

from kerfin_engine import insurers


@pytest.mark.parametrize(
    ("contract", "insurer"),
    [
        ("Linxea Spirit 2", "Spirica"),
        ("Linxea Spirit PER", "Spirica"),
        ("Linxea Avenir", "Suravenir"),
        ("Linxea Suravenir PER", "Suravenir"),
        ("Lucya Abeille", "Abeille Vie"),
        ("Lucya Cardif PER", "BNP Paribas Cardif"),
        ("Livret A", None),
        (None, None),
    ],
)
def test_known_contracts(contract: str | None, insurer: str | None) -> None:
    assert insurers.suggest(contract) == insurer
