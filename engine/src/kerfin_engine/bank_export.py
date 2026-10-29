"""Transactions from a bank's CSV export, for the accounts Finary's plan doesn't give them.

BoursoBank's export (semicolon-separated, one line per transaction) covers its accounts and
those it aggregates (other banks, cards). Its header, as exported in 2026-10:

    Date Opération;"Date Valeur";Libellé;Tags;"Libellé Suggéré";Catégorie;"Catégorie Parente";
    Solde;Commentaire;"Numéro Compte";"Libellé Compte";Solde;Pointage

"Solde" appears twice: the first is the transaction's amount, the second the account's
balance after it. Older exports name the amount "Montant" ("amount" in English ones).
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from kerfin_engine.domain import AccountKind, Transaction
from kerfin_engine.store import Store


class ExportError(ValueError):
    pass


@dataclass
class ExportAccount:
    number: str
    label: str
    balance: Decimal | None = None  # after the latest transaction, when the file says
    transactions: list[Transaction] = field(default_factory=list)


def _key(name: str) -> str:
    """A column name compared loosely: lowercase, without accents, quotes or spaces."""
    decomposed = unicodedata.normalize("NFKD", name.strip().strip('"').lower())
    return re.sub(r"[^a-z]", "", "".join(c for c in decomposed if not unicodedata.combining(c)))


# Column names, loosely compared, as BoursoBank's French and English exports give them.
_COLUMNS = {
    "date": ("dateoperation", "dateop"),
    "label": ("libelle", "label"),
    "payee": ("libellesuggere", "supplierfound"),
    "category": ("categorie", "category"),
    "parent": ("categorieparente", "categoryparent"),
    "amount": ("montant", "amount"),
    "number": ("numerocompte", "accountnum"),
    "account": ("libellecompte", "accountlabel"),
    "balance": ("soldecompte", "accountbalance"),
}


def _text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ExportError("unreadable_encoding")


def _amount(value: str) -> Decimal | None:
    """French or plain amounts: "-1 234,56", "1234.56", "−12,50 €"."""
    text = re.sub(r"[\s  €]", "", value).replace("−", "-")
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return Decimal(text) if text else None
    except InvalidOperation:
        return None


def _date(value: str) -> date | None:
    value = value.strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    return None


def _columns(header: list[str]) -> dict[str, int]:
    keys = [_key(name) for name in header]
    found = {}
    for name, accepted in _COLUMNS.items():
        index = next((i for i, key in enumerate(keys) if key in accepted), None)
        if index is not None:
            found[name] = index
    # BoursoBank's 2026 export: the amount, then the account's balance, both called "Solde".
    soldes = [i for i, key in enumerate(keys) if key == "solde"]
    if "amount" not in found and soldes:
        found["amount"] = soldes[0]
    if "balance" not in found and len(soldes) > 1:
        found["balance"] = soldes[-1]
    missing = [name for name in ("date", "label", "amount") if name not in found]
    if missing:
        raise ExportError(f"missing_columns:{','.join(missing)}")
    return found


def read(data: bytes) -> list[ExportAccount]:
    """The accounts in an export, each with its transactions, newest first."""
    rows = list(csv.reader(io.StringIO(_text(data)), delimiter=";"))
    rows = [row for row in rows if any(cell.strip() for cell in row)]
    if not rows:
        raise ExportError("empty_file")
    columns = _columns(rows[0])

    def cell(row: list[str], name: str) -> str:
        index = columns.get(name)
        return row[index].strip() if index is not None and index < len(row) else ""

    accounts: dict[str, ExportAccount] = {}
    latest: dict[str, date] = {}
    for row in rows[1:]:
        day, amount = _date(cell(row, "date")), _amount(cell(row, "amount"))
        if day is None or amount is None:
            continue
        number = cell(row, "number")
        account = accounts.setdefault(number, ExportAccount(number, cell(row, "account") or number))
        account.transactions.append(
            Transaction(
                date=day,
                label=" ".join(cell(row, "label").split()) or "?",
                amount=amount,
                currency="EUR",
                category=cell(row, "category") or None,
                category_parent=cell(row, "parent") or None,
                payee=cell(row, "payee") or None,
            )
        )
        balance = _amount(cell(row, "balance"))
        # The balance after the newest day's first line (files list the newest first).
        if balance is not None and (number not in latest or day > latest[number]):
            account.balance, latest[number] = balance, day
    if not accounts:
        raise ExportError("no_transactions")
    for account in accounts.values():
        account.transactions.sort(key=lambda t: t.date, reverse=True)
    return list(accounts.values())


# Where an export's account number was imported last: kept to import there again.
_REMEMBERED = "import_account:"
# Institutions an aggregated account's name gives away; else the export's bank.
_INSTITUTIONS = (
    (r"amex|american express", "American Express"),
    (r"fortuneo", "Fortuneo"),
    (r"boursorama|boursobank", "BoursoBank"),
)
_CARD = re.compile(r"carte|card|amex|american express|visa|mastercard", re.IGNORECASE)


def _plain(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return " ".join(
        "".join(c if c.isalnum() else " " for c in decomposed if not unicodedata.combining(c)).split()
    )


def target(store: Store, account: ExportAccount) -> str | None:
    """The account an export's account goes to: where it went last time, else the account
    with the same name; None for a new one."""
    accounts = store.accounts()
    remembered = store.setting(_REMEMBERED + account.number, "") if account.number else ""
    if any(a["id"] == remembered for a in accounts):
        return remembered
    name = _plain(account.label)
    same = [a for a in accounts if name and _plain(a["label"]) == name]
    return same[0]["id"] if len(same) == 1 else None


@dataclass(frozen=True)
class NewAccount:
    """What the user chose for an account the import creates."""

    label: str
    kind: AccountKind
    institution: str | None = None


def institution(account: ExportAccount) -> str:
    """Where an export's account is held: as its name gives away, else the export's bank."""
    return next(
        (name for pattern, name in _INSTITUTIONS if re.search(pattern, account.label, re.IGNORECASE)),
        "BoursoBank",
    )


def kind(account: ExportAccount) -> AccountKind:
    return AccountKind.CARD if _CARD.search(account.label) else AccountKind.CHECKING


def save(
    store: Store,
    accounts: list[ExportAccount],
    targets: dict[str, object],
    new_accounts: dict[str, NewAccount] | None = None,
) -> int:
    """Imports each account's transactions where `targets` says (an account id, "new" or
    "skip"); a new account takes the name, kind and institution `new_accounts` gives, else
    the file's name and guesses. Returns how many transactions were imported."""
    known = {a["id"]: a for a in store.accounts()}
    count = 0
    for account in accounts:
        chosen = targets.get(account.number, "skip")
        if chosen == "skip" or not account.transactions:
            continue
        if chosen == "new":
            given = (new_accounts or {}).get(account.number) or NewAccount(account.label, kind(account))
            account_id = store.add_manual_account(
                given.institution or institution(account),
                given.label,
                given.kind,
                account.balance or Decimal(0),
                "EUR",
            )
        elif isinstance(chosen, str) and chosen in known:
            account_id = chosen
            # An account entered by hand takes the export's balance; a synced one keeps its source's.
            if known[chosen]["connection_id"] is None and account.balance is not None:
                store.set_manual_balance(account_id, account.balance)
        else:
            raise KeyError(chosen)
        store.import_transactions(account_id, account.transactions)
        if account.number:
            store.set_setting(_REMEMBERED + account.number, account_id)
        count += len(account.transactions)
    return count
