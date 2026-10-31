from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from kerfin_engine import bank_export
from kerfin_engine.domain import AccountKind
from kerfin_engine.store import Store

HEADER = (
    'Date Opération;"Date Valeur";Libellé;Tags;"Libellé Suggéré";Catégorie;"Catégorie Parente";'
    'Solde;Commentaire;"Numéro Compte";"Libellé Compte";Solde;Pointage\t\t\t'
)
# Made-up lines in BoursoBank's 2026 layout, newest first, two accounts.
LINES = [
    '2026-10-28;2026-10-28;"CARTE 27/10/26 SOME GROCER CB*1234";;"Some Grocer";Supermarché;Alimentation;'
    '-42,10;;00000000001;"COMPTE BANCAIRE";1 957,90;0',
    '2026-10-28;2026-10-28;"VIR SEPA EMPLOYER";;"Employer";Salaires;Revenus;2000,00;;00000000001;'
    '"COMPTE BANCAIRE";2 000,00;0',
    '2026-10-02;2026-10-02;"SOME AIRLINE";;"Some Airline";Avion;Voyages;-310,00;;99999;'
    '"Carte Amex";-310,00;0',
]


def export(*lines: str, encoding: str = "utf-8-sig") -> bytes:
    return "\r\n".join([HEADER, *lines]).encode(encoding)


def test_boursobank_export_is_read_by_account() -> None:
    current, card = bank_export.read(export(*LINES))

    assert (current.number, current.label, current.balance) == (
        "00000000001",
        "COMPTE BANCAIRE",
        Decimal("1957.90"),
    )
    grocer = current.transactions[0]
    assert (grocer.date, grocer.amount, grocer.payee, grocer.category, grocer.category_parent) == (
        date(2026, 10, 28),
        Decimal("-42.10"),
        "Some Grocer",
        "Supermarché",
        "Alimentation",
    )
    assert current.transactions[1].amount == Decimal("2000.00")
    assert card.label == "Carte Amex" and card.transactions[0].amount == Decimal("-310.00")


def test_windows_encoded_exports_are_read() -> None:
    [current, _] = bank_export.read(export(*LINES, encoding="cp1252"))
    assert current.transactions[0].category == "Supermarché"


AMEX_HEADER = (
    "Date,Description,Titulaire,Numéro de Compte,Montant,Détails,"
    "Apparait sur votre relevé de compte sous,Adresse,Ville,Code postal,Pays,Référence,Catégorie"
)
# Made-up lines in American Express's 2026 layout: two cards, charges positive, month first.
AMEX_LINES = [
    '10/27/2026,SOME BAKERY        SOMEWHERE,A SAMPLE,-11111,"4,20",,SOME BAKERY        SOMEWHERE,'
    "\"1 SOME STREET\nSOMEWHERE\",,99999,FRANCE,'AT000000000000000000001',Miscellaneous-Other",
    "10/13/2026,PAIEMENT RECU - MERCI,A SAMPLE,-11111,\"-1234,56\",,PAIEMENT RECU - MERCI,,,,,'000002',",
    "09/30/2026,SOME AIRLINE,B SAMPLE,-22222,\"1 234,00\",,SOME AIRLINE,,,,,'AT000000000000000000003',"
    "Travel-Airline",
]


def test_amex_export_is_read_as_one_card_account() -> None:
    [card] = bank_export.read("\n".join([AMEX_HEADER, *AMEX_LINES]).encode())

    assert (card.number, card.label, card.amex, card.balance) == (
        "-11111 -22222",
        "American Express",
        True,
        None,
    )
    assert (bank_export.kind(card), bank_export.institution(card)) == (AccountKind.CARD, "American Express")
    bakery, payment, airline = card.transactions
    assert (bakery.date, bakery.label, bakery.amount) == (
        date(2026, 10, 27),
        "SOME BAKERY SOMEWHERE",
        Decimal("-4.20"),
    )
    assert payment.amount == Decimal("1234.56") and payment.category is None
    assert (airline.amount, airline.category_parent, airline.category) == (
        Decimal("-1234.00"),
        "Travel",
        "Airline",
    )


def test_amex_import_goes_to_the_card_boursobank_brought() -> None:
    store = Store.create()
    [current, card] = bank_export.read(export(*LINES))
    bank_export.save(store, [current, card], {current.number: "new", card.number: "new"})
    [amex] = bank_export.read("\n".join([AMEX_HEADER, *AMEX_LINES]).encode())

    brought = next(a["id"] for a in store.accounts() if a["label"] == "Carte Amex")
    assert bank_export.target(store, amex) == brought


def test_two_accounts_imported_into_one_keep_each_others() -> None:
    store = Store.create()
    account = store.add_manual_account("BoursoBank", "Compte", AccountKind.CHECKING, Decimal("1"), "EUR")
    same_day = '2026-10-28;2026-10-28;"SOME SHOP";;"Some Shop";;;-9,00;;99999;"Carte Amex";-319,00;0'
    current, card = bank_export.read(export(*LINES, same_day))
    assert bank_export.save(store, [current, card], {current.number: account, card.number: account}) == 4
    assert len(store.transactions(account)) == 4


def test_amounts_with_thousands_separators() -> None:
    assert bank_export._amount("1,234.56") == Decimal("1234.56")
    assert bank_export._amount("-1 234,56") == Decimal("-1234.56")
    assert bank_export._amount("1.234,56") == Decimal("1234.56")
    assert bank_export._amount("12.50") == Decimal("12.50")


def test_files_that_are_no_export_are_refused() -> None:
    with pytest.raises(bank_export.ExportError):
        bank_export.read(b"name,value\nfoo,1\n")
    with pytest.raises(bank_export.ExportError):
        bank_export.read(export())


def test_imports_go_to_new_or_existing_accounts_and_are_remembered() -> None:
    store = Store.create()
    existing = store.add_manual_account(
        "BoursoBank", "Compte bancaire", AccountKind.CHECKING, Decimal("1"), "EUR"
    )
    current, card = bank_export.read(export(*LINES))
    # The same name: the existing account; an unknown one: a new account.
    assert bank_export.target(store, current) == existing and bank_export.target(store, card) is None

    assert bank_export.save(store, [current, card], {current.number: existing, card.number: "new"}) == 3
    accounts = {a["label"]: a for a in store.accounts()}
    assert accounts["Compte bancaire"]["balance"] == "1957.90"  # an account entered by hand takes the file's
    amex = accounts["Carte Amex"]
    assert (amex["kind"], amex["institution_name"], amex["balance"]) == (
        "card",
        "American Express",
        "-310.00",
    )
    assert bank_export.target(store, card) == amex["id"]  # remembered for the next import

    # Importing again replaces the days the file covers: no duplicates.
    bank_export.save(store, [current], {current.number: existing})
    assert len(store.transactions(existing)) == 2


def test_an_import_keeps_older_and_newer_history() -> None:
    store = Store.create()
    account = store.add_manual_account("BoursoBank", "Compte", AccountKind.CHECKING, Decimal("1"), "EUR")
    [current, _] = bank_export.read(export(*LINES))
    old = '2026-08-01;2026-08-01;"OLD";;"Old";;;-5,00;;00000000001;"COMPTE BANCAIRE";1,00;0'
    [earlier] = bank_export.read(export(old))
    bank_export.save(store, [current], {current.number: account})
    bank_export.save(store, [earlier], {earlier.number: account})

    assert [t["label"] for t in store.transactions(account)][-1] == "OLD"
    assert len(store.transactions(account)) == 3


def test_category_rules_are_kept_and_forgotten() -> None:
    store = Store.create()
    store.set_category_rule("some grocer", "groceries")
    assert store.category_rules() == {"some grocer": "groceries"}
    store.set_category_rule("some grocer", None)
    assert store.category_rules() == {}
