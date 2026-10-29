from __future__ import annotations

import json
from importlib import resources

from kerfin_engine import contract_fees


def test_the_most_specific_contract_name_wins_for_the_account_s_kind() -> None:
    per = contract_fees.suggest("Mon Linxea Spirit PER", "retirement")
    life = contract_fees.suggest("LINXEA SPIRIT 2 - épargne", "life_insurance")
    assert per is not None and per["contract"] == "Linxea Spirit PER"
    assert life is not None and life["contract"] == "Linxea Spirit 2"
    assert per["uc"] == "0.005"  # 0.5% a year


def test_the_first_linxea_avenir_is_estimated_from_avenir_2() -> None:
    first = contract_fees.suggest("Linxea Avenir", "life_insurance")
    second = contract_fees.suggest("LINXEA AVENIR 2", "life_insurance")
    assert first is not None and first["contract"] == "Linxea Avenir 2"
    assert second is not None and second["contract"] == "Linxea Avenir 2"
    # Linxea's PER is a different contract, whatever its name.
    per = contract_fees.suggest("Linxea Avenir PER", "retirement")
    assert per is not None and per["contract"] == "Linxea Suravenir PER"


def test_no_suggestion_for_unknown_contracts_or_other_kinds() -> None:
    assert contract_fees.suggest("Some Other Contract", "life_insurance") is None
    assert contract_fees.suggest("Linxea Spirit 2", "securities") is None
    assert contract_fees.suggest(None, "retirement") is None


def test_every_contract_has_a_source_and_plausible_fees() -> None:
    data = resources.files("kerfin_engine").joinpath("data/contract_fees.json").read_text(encoding="utf-8")
    for contract in json.loads(data)["contracts"]:
        assert contract["kind"] in ("life_insurance", "retirement")
        assert contract["source"]
        assert 0 < contract["uc_fee"] < 2
        assert contract["euro_fee"] is None or 0 < contract["euro_fee"] < 2
