from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from kerfin_engine import vault as vault_module
from kerfin_engine.domain import Account, AccountKind, Holding, Transaction
from kerfin_engine.store import Store
from kerfin_engine.vault import Vault, VaultError, WrongPassphrase

PASSPHRASE = "correct horse battery"


@pytest.fixture(autouse=True)
def fast_kdf(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(vault_module.DEFAULT_KDF, "memory_cost", 1024)
    monkeypatch.setitem(vault_module.DEFAULT_KDF, "iterations", 1)


def test_vault_round_trip_and_nothing_in_clear(tmp_path: Path) -> None:
    vault = Vault(tmp_path / "kerfin.vault")
    vault.create(PASSPHRASE, b"secret bank password")
    assert b"secret" not in vault.path.read_bytes()

    vault.lock()
    assert Vault(vault.path).unlock(PASSPHRASE) == b"secret bank password"


def test_vault_rejects_wrong_passphrase_and_tampering(tmp_path: Path) -> None:
    vault = Vault(tmp_path / "kerfin.vault")
    vault.create(PASSPHRASE, b"data")
    with pytest.raises(WrongPassphrase):
        Vault(vault.path).unlock("not the passphrase")

    blob = bytearray(vault.path.read_bytes())
    blob[-1] ^= 1
    vault.path.write_bytes(bytes(blob))
    with pytest.raises(WrongPassphrase):
        Vault(vault.path).unlock(PASSPHRASE)


def test_vault_rejects_short_passphrase_and_keeps_backup(tmp_path: Path) -> None:
    with pytest.raises(VaultError):
        Vault(tmp_path / "a.vault").create("short", b"")

    vault = Vault(tmp_path / "kerfin.vault")
    vault.create(PASSPHRASE, b"v1")
    vault.save(b"v2")
    assert Vault(vault.path.with_suffix(".bak")).unlock(PASSPHRASE) == b"v1"


def _sync(store: Store, connection_id: str, balance: str, day: date) -> None:
    account = Account("acc-1", "PEA", AccountKind.PEA, Decimal(balance), "EUR", "PEA")
    holdings = [Holding("ETF World", Decimal(balance), "EUR", isin="FR0011869353")]
    transactions = [Transaction(day, "Deposit", Decimal("100"), "EUR")]
    store.save_sync(connection_id, [(account, holdings, transactions)], today=day)


def test_store_survives_serialisation_and_tracks_history() -> None:
    store = Store.create()
    connection_id = store.add_connection("demo", "Demo", {"login": "me"}, {"password": "pw"}, remember=True)
    _sync(store, connection_id, "1000.00", date(2026, 1, 1))
    _sync(store, connection_id, "1100.50", date(2026, 2, 1))

    reloaded = Store.load(store.dump())
    [account] = reloaded.accounts()
    assert account["balance"] == "1100.50"
    assert account["institution"] == "demo"
    assert [h["balance"] for h in reloaded.balance_history()] == ["1000.00", "1100.50"]
    assert reloaded.holdings(account["id"])[0]["isin"] == "FR0011869353"
    assert len(reloaded.transactions(account["id"])) == 2
    assert reloaded.secrets(connection_id) == {"password": "pw"}


def test_secrets_kept_only_when_remembered() -> None:
    store = Store.create()
    connection_id = store.add_connection("demo", "Demo", {"login": "me"}, {"password": "pw"}, remember=False)
    assert store.secrets(connection_id) == {}
    store.set_credentials(connection_id, {"login": "me"}, {"password": "pw2"}, remember=True)
    assert store.secrets(connection_id) == {"password": "pw2"}


def test_deleting_a_connection_deletes_its_data() -> None:
    store = Store.create()
    connection_id = store.add_connection("demo", "Demo", {}, {"password": "pw"}, remember=True)
    _sync(store, connection_id, "10", date(2026, 1, 1))
    store.delete_connection(connection_id)
    assert store.accounts() == [] and store.balance_history() == [] and store.secrets(connection_id) == {}


def test_manual_account_balance_updates() -> None:
    store = Store.create()
    account_id = store.add_manual_account(
        "Baloise", "Luxavie", AccountKind.LIFE_INSURANCE, Decimal("5"), "EUR"
    )
    store.set_manual_balance(account_id, Decimal("7.5"), today=date(2030, 1, 1))
    [account] = store.accounts()
    assert account["balance"] == "7.5" and account["institution_name"] == "Baloise"
    assert store.balance_history()[-1]["balance"] == "7.5"


def test_chosen_kind_and_insurer_survive_syncs() -> None:
    store = Store.create()
    connection_id = store.add_connection("finary", "Finary", {}, {}, remember=True)
    _sync(store, connection_id, "1000.00", date(2026, 1, 1))
    [account] = store.accounts()
    store.update_account(account["id"], kind=AccountKind.PEA, insurer="  ")
    store.update_account(account["id"], insurer="Spirica")
    _sync(store, connection_id, "1100.00", date(2026, 1, 2))

    [account] = Store.load(store.dump()).accounts()
    assert (account["kind"], account["kind_set"], account["insurer"]) == ("pea", True, "Spirica")
    store.update_account(account["id"], reset_kind=True, insurer="")
    [account] = store.accounts()
    assert (
        account["kind"] == account["kind_detected"] and not account["kind_set"] and account["insurer"] is None
    )


def test_insurer_is_suggested_from_the_contract_name() -> None:
    store = Store.create()
    store.add_manual_account("LinXea", "Linxea Spirit 2", AccountKind.LIFE_INSURANCE, Decimal("5"), "EUR")
    [account] = store.accounts()
    assert account["insurer_suggested"] == "Spirica"


def test_older_vaults_are_migrated() -> None:
    store = Store.create()
    # Back to the first schema: what versions 2 and 3 added goes.
    for column in ("kind_override", "insurer"):
        store._db.execute(f"ALTER TABLE accounts DROP COLUMN {column}")
    for column in ("unit_value_currency", "security_type", "fees", "match"):
        store._db.execute(f"ALTER TABLE holdings DROP COLUMN {column}")
    for table in ("securities", "prices", "fx_rates"):
        store._db.execute(f"DROP TABLE {table}")
    store._db.execute("PRAGMA user_version = 1")
    store.add_manual_account("Baloise", "Luxavie", AccountKind.LIFE_INSURANCE, Decimal("5"), "EUR")

    migrated = Store.load(store.dump())
    [account] = migrated.accounts()
    assert account["insurer"] is None and not account["kind_set"]
    assert migrated.holdings() == [] and migrated.market()["prices"] == {}
    assert migrated._db.execute("PRAGMA user_version").fetchone()[0] == 5


def test_stray_card_choices_are_cleared() -> None:
    store = Store.create()
    connection_id = store.add_connection("finary", "Finary", {}, {}, remember=True)
    _sync(store, connection_id, "1000.00", date(2026, 1, 1))
    [account] = store.accounts()
    store.update_account(account["id"], kind=AccountKind.CARD)
    store._db.execute("ALTER TABLE holdings DROP COLUMN match")  # added by version 5
    store._db.execute("PRAGMA user_version = 3")

    [account] = Store.load(store.dump()).accounts()
    assert account["kind"] == account["kind_detected"] != "card" and not account["kind_set"]
