"""Normalised financial data, independent of where it was collected.

Every connector maps its source data to these types. The TypeScript core mirrors them,
so field names and enum values are part of the engine's public contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import StrEnum


class AccountKind(StrEnum):
    CHECKING = "checking"
    SAVINGS = "savings"
    LIFE_INSURANCE = "life_insurance"
    RETIREMENT = "retirement"  # PER, PERP, Madelin...
    PEA = "pea"
    SECURITIES = "securities"  # CTO
    EMPLOYEE_SAVINGS = "employee_savings"
    CROWDFUNDING = "crowdfunding"
    REAL_ESTATE = "real_estate"
    CRYPTO = "crypto"
    CARD = "card"
    LOAN = "loan"
    OTHER = "other"


@dataclass(frozen=True)
class Account:
    external_id: str
    label: str
    kind: AccountKind
    balance: Decimal | None
    currency: str | None
    # Source-specific detail (e.g. "LIVRET_A"), kept because French tax rules depend on it.
    subtype: str | None = None
    number: str | None = None
    opening_date: date | None = None


@dataclass(frozen=True)
class Holding:
    label: str
    valuation: Decimal | None
    currency: str | None
    isin: str | None = None
    quantity: Decimal | None = None
    unit_value: Decimal | None = None
    unit_price: Decimal | None = None  # average purchase price
    value_date: date | None = None


@dataclass(frozen=True)
class Transaction:
    date: date
    label: str
    amount: Decimal
    currency: str | None
    pending: bool = False
