"""The user's database: connections, credentials, accounts, holdings, transactions, history.

It is an in-memory SQLite database, serialised into the encrypted vault after each change.
Amounts are stored as decimal strings, never floats.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from kerfin_engine import insurers
from kerfin_engine.domain import Account, AccountKind, Holding, Transaction

SCHEMA = """
CREATE TABLE connections (
    id TEXT PRIMARY KEY,
    institution TEXT NOT NULL,
    label TEXT NOT NULL,
    params TEXT NOT NULL,          -- JSON: fields the user entered that are kept (login...)
    remember_secrets INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_sync_at TEXT,
    last_status TEXT,              -- ok | an ErrorCode
    last_error TEXT
);
CREATE TABLE secrets (
    connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    data TEXT NOT NULL             -- JSON: secret fields (password...)
);
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,  -- NULL for manual accounts
    external_id TEXT,
    institution_name TEXT,         -- manual accounts, and accounts of aggregators (Finary)
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    subtype TEXT,
    number TEXT,
    currency TEXT,
    balance TEXT,
    opening_date TEXT,
    updated_at TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    kind_override TEXT,            -- the user's choice, kept across syncs
    insurer TEXT,                  -- life insurance and PER: set by the user
    UNIQUE (connection_id, external_id)
);
CREATE TABLE holdings (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    isin TEXT,
    quantity TEXT,
    unit_value TEXT,
    unit_price TEXT,
    valuation TEXT,
    currency TEXT,
    value_date TEXT
);
CREATE TABLE transactions (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    label TEXT NOT NULL,
    amount TEXT NOT NULL,
    currency TEXT,
    pending INTEGER NOT NULL
);
CREATE INDEX transactions_by_account ON transactions(account_id, date);
CREATE TABLE balance_history (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    balance TEXT NOT NULL,
    PRIMARY KEY (account_id, date)
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""
SCHEMA_VERSION = 2

# Steps from each older schema version to the next.
MIGRATIONS = {
    1: (
        "ALTER TABLE accounts ADD COLUMN kind_override TEXT",
        "ALTER TABLE accounts ADD COLUMN insurer TEXT",
    ),
}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _text(value: Decimal | date | None) -> str | None:
    return None if value is None else str(value)


def new_id() -> str:
    return uuid.uuid4().hex


class Store:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        # The HTTP server and sync jobs run in different threads.
        self.lock = threading.RLock()

    @classmethod
    def create(cls) -> Store:
        store = cls(sqlite3.connect(":memory:", check_same_thread=False))
        store._db.executescript(SCHEMA)
        store._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        return store

    @classmethod
    def load(cls, data: bytes) -> Store:
        connection = sqlite3.connect(":memory:", check_same_thread=False)
        connection.deserialize(data)
        store = cls(connection)
        version = store._db.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise ValueError("This data was written by a newer Kerfin; update the app")
        with store.transaction() as db:
            for step in range(version, SCHEMA_VERSION):
                for statement in MIGRATIONS[step]:
                    db.execute(statement)
            db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        return store

    def dump(self) -> bytes:
        with self.lock:
            return self._db.serialize()

    def close(self) -> None:
        self._db.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.lock, self._db:
            yield self._db

    def _rows(self, sql: str, *args: Any) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(row) for row in self._db.execute(sql, args)]

    # Settings

    def setting(self, key: str, default: str) -> str:
        rows = self._rows("SELECT value FROM settings WHERE key = ?", key)
        return rows[0]["value"] if rows else default

    def set_setting(self, key: str, value: str) -> None:
        with self.transaction() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, value))

    # Connections and their credentials

    def add_connection(
        self, institution: str, label: str, params: dict[str, str], secrets: dict[str, str], remember: bool
    ) -> str:
        connection_id = new_id()
        with self.transaction() as db:
            db.execute(
                "INSERT INTO connections (id, institution, label, params, remember_secrets, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (connection_id, institution, label, json.dumps(params), int(remember), _now()),
            )
            if remember and secrets:
                db.execute("INSERT INTO secrets VALUES (?, ?)", (connection_id, json.dumps(secrets)))
        return connection_id

    def set_credentials(
        self, connection_id: str, params: dict[str, str], secrets: dict[str, str], remember: bool
    ) -> None:
        with self.transaction() as db:
            updated = db.execute(
                "UPDATE connections SET params = ?, remember_secrets = ? WHERE id = ?",
                (json.dumps(params), int(remember), connection_id),
            ).rowcount
            if not updated:
                raise KeyError(connection_id)
            db.execute("DELETE FROM secrets WHERE connection_id = ?", (connection_id,))
            if remember and secrets:
                db.execute("INSERT INTO secrets VALUES (?, ?)", (connection_id, json.dumps(secrets)))

    def replace_secrets(self, connection_id: str, secrets: dict[str, str]) -> None:
        """Keep renewed tokens (e.g. a rotated OAuth refresh token)."""
        with self.transaction() as db:
            db.execute("INSERT OR REPLACE INTO secrets VALUES (?, ?)", (connection_id, json.dumps(secrets)))

    def connections(self) -> list[dict[str, Any]]:
        rows = self._rows("SELECT * FROM connections ORDER BY created_at")
        for row in rows:
            row["params"] = json.loads(row["params"])
            row["remember_secrets"] = bool(row["remember_secrets"])
        return rows

    def connection(self, connection_id: str) -> dict[str, Any]:
        for row in self.connections():
            if row["id"] == connection_id:
                return row
        raise KeyError(connection_id)

    def secrets(self, connection_id: str) -> dict[str, str]:
        rows = self._rows("SELECT data FROM secrets WHERE connection_id = ?", connection_id)
        return json.loads(rows[0]["data"]) if rows else {}

    def delete_connection(self, connection_id: str) -> None:
        with self.transaction() as db:
            db.execute("DELETE FROM connections WHERE id = ?", (connection_id,))

    def record_sync(self, connection_id: str, status: str, error: str | None = None) -> None:
        with self.transaction() as db:
            db.execute(
                "UPDATE connections SET last_sync_at = ?, last_status = ?, last_error = ? WHERE id = ?",
                (_now(), status, error, connection_id),
            )

    # Accounts

    def save_sync(
        self,
        connection_id: str,
        accounts: Iterable[tuple[Account, list[Holding] | None, list[Transaction]]],
        today: date | None = None,
    ) -> int:
        """Store what one sync collected. Holdings of None means "not collected": keep the old ones."""
        today = today or date.today()
        count = 0
        with self.transaction() as db:
            for account, holdings, transactions in accounts:
                account_id = self._upsert_account(db, connection_id, account)
                if account.balance is not None:
                    db.execute(
                        "INSERT OR REPLACE INTO balance_history VALUES (?, ?, ?)",
                        (account_id, today.isoformat(), str(account.balance)),
                    )
                if holdings is not None:
                    db.execute("DELETE FROM holdings WHERE account_id = ?", (account_id,))
                    db.executemany(
                        "INSERT INTO holdings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [
                            (
                                account_id,
                                h.label,
                                h.isin,
                                _text(h.quantity),
                                _text(h.unit_value),
                                _text(h.unit_price),
                                _text(h.valuation),
                                h.currency,
                                _text(h.value_date),
                            )
                            for h in holdings
                        ],
                    )
                if transactions:
                    # Websites only show a recent window: replace that window, keep older history.
                    oldest = min(t.date for t in transactions).isoformat()
                    db.execute(
                        "DELETE FROM transactions WHERE account_id = ? AND date >= ?", (account_id, oldest)
                    )
                    db.executemany(
                        "INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?)",
                        [
                            (
                                account_id,
                                t.date.isoformat(),
                                t.label,
                                str(t.amount),
                                t.currency,
                                int(t.pending),
                            )
                            for t in transactions
                        ],
                    )
                count += 1
        return count

    def _upsert_account(self, db: sqlite3.Connection, connection_id: str, account: Account) -> str:
        row = db.execute(
            "SELECT id FROM accounts WHERE connection_id = ? AND external_id = ?",
            (connection_id, account.external_id),
        ).fetchone()
        values = (
            account.institution,
            account.label,
            str(account.kind),
            account.subtype,
            account.number,
            account.currency,
            _text(account.balance),
            _text(account.opening_date),
            _now(),
        )
        if row:
            db.execute(
                "UPDATE accounts SET institution_name = ?, label = ?, kind = ?, subtype = ?, number = ?,"
                " currency = ?, balance = ?, opening_date = ?, updated_at = ? WHERE id = ?",
                (*values, row["id"]),
            )
            return row["id"]
        account_id = new_id()
        db.execute(
            "INSERT INTO accounts (institution_name, label, kind, subtype, number, currency, balance,"
            " opening_date, updated_at, id, connection_id, external_id)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (*values, account_id, connection_id, account.external_id),
        )
        return account_id

    def add_manual_account(
        self, institution_name: str, label: str, kind: AccountKind, balance: Decimal, currency: str
    ) -> str:
        account_id = new_id()
        with self.transaction() as db:
            db.execute(
                "INSERT INTO accounts (id, institution_name, label, kind, currency, balance, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (account_id, institution_name, label, str(kind), currency, str(balance), _now()),
            )
        self.set_manual_balance(account_id, balance)
        return account_id

    def set_manual_balance(self, account_id: str, balance: Decimal, today: date | None = None) -> None:
        with self.transaction() as db:
            updated = db.execute(
                "UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND connection_id IS NULL",
                (str(balance), _now(), account_id),
            ).rowcount
            if not updated:
                raise KeyError(account_id)
            db.execute(
                "INSERT OR REPLACE INTO balance_history VALUES (?, ?, ?)",
                (account_id, (today or date.today()).isoformat(), str(balance)),
            )

    def update_account(
        self,
        account_id: str,
        *,
        label: str | None = None,
        hidden: bool | None = None,
        kind: AccountKind | None = None,
        reset_kind: bool = False,
        insurer: str | None = None,
    ) -> None:
        """Changes what the user controls. An empty `insurer` clears it; `reset_kind` goes
        back to the detected kind."""
        with self.transaction() as db:
            if label is not None:
                db.execute("UPDATE accounts SET label = ? WHERE id = ?", (label, account_id))
            if hidden is not None:
                db.execute("UPDATE accounts SET hidden = ? WHERE id = ?", (int(hidden), account_id))
            if kind is not None or reset_kind:
                db.execute(
                    "UPDATE accounts SET kind_override = ? WHERE id = ?",
                    (None if reset_kind else str(kind), account_id),
                )
            if insurer is not None:
                db.execute(
                    "UPDATE accounts SET insurer = ? WHERE id = ?", (insurer.strip() or None, account_id)
                )

    def delete_manual_account(self, account_id: str) -> None:
        with self.transaction() as db:
            db.execute("DELETE FROM accounts WHERE id = ? AND connection_id IS NULL", (account_id,))

    def accounts(self) -> list[dict[str, Any]]:
        rows = self._rows(
            "SELECT a.id, a.connection_id, c.institution, a.institution_name, a.label,"
            " COALESCE(a.kind_override, a.kind) AS kind, a.kind AS kind_detected,"
            " a.kind_override IS NOT NULL AS kind_set, a.insurer, a.subtype, a.number, a.currency,"
            " a.balance, a.opening_date, a.updated_at, a.hidden"
            " FROM accounts a LEFT JOIN connections c ON c.id = a.connection_id ORDER BY a.label"
        )
        for row in rows:
            row["hidden"] = bool(row["hidden"])
            row["kind_set"] = bool(row["kind_set"])
            # A suggestion from the contract's name until the user sets the insurer.
            row["insurer_suggested"] = None if row["insurer"] else insurers.suggest(row["label"])
        return rows

    def holdings(self, account_id: str) -> list[dict[str, Any]]:
        return self._rows(
            "SELECT label, isin, quantity, unit_value, unit_price, valuation, currency, value_date"
            " FROM holdings WHERE account_id = ? ORDER BY CAST(valuation AS REAL) DESC",
            account_id,
        )

    def transactions(self, account_id: str, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._rows(
            "SELECT date, label, amount, currency, pending FROM transactions WHERE account_id = ?"
            " ORDER BY date DESC LIMIT ?",
            account_id,
            limit,
        )
        for row in rows:
            row["pending"] = bool(row["pending"])
        return rows

    def balance_history(self) -> list[dict[str, Any]]:
        return self._rows("SELECT account_id, date, balance FROM balance_history ORDER BY date")
