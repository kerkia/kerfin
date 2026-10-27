from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime
from decimal import Decimal

import pytest
from woob.capabilities.bank import Account as WoobAccount
from woob.capabilities.bank import AccountType
from woob.capabilities.bank import Transaction as WoobTransaction
from woob.capabilities.bank.wealth import Investment
from woob.capabilities.base import NotAvailable
from woob.exceptions import BrowserIncorrectPassword, BrowserQuestion, DecoupledValidation, ScrapingBlocked
from woob.tools.value import Value, ValueBackendPassword, ValueTransient

from kerfin_engine import paths
from kerfin_engine.connectors import ConnectorError, ErrorCode, Prompt
from kerfin_engine.connectors.woob_connector import (
    WoobConnector,
    account_from_woob,
    config_prompts,
    holding_from_woob,
    prompt_from_value,
    transaction_from_woob,
)
from kerfin_engine.domain import AccountKind


class ScriptedInteraction:
    def __init__(self, *answers: str) -> None:
        self.answers = list(answers)
        self.prompts: list[Prompt] = []
        self.messages: list[str] = []

    def ask(self, prompt: Prompt) -> str:
        self.prompts.append(prompt)
        return self.answers.pop(0)

    def notify(self, message: str) -> None:
        self.messages.append(message)


class FakeBackend:
    def __init__(self, *challenges: Exception) -> None:
        self.config = {
            "otp_sms": ValueTransient("otp_sms", label="SMS code"),
            "resume": ValueTransient("resume"),
        }
        self.challenges = list(challenges)
        self.calls = 0

    def iter_accounts(self) -> Iterator[WoobAccount]:
        self.calls += 1
        if self.challenges:
            raise self.challenges.pop(0)
        account = WoobAccount(id="123")
        account.label = "Livret A"
        account.type = AccountType.LIVRET_A
        account.balance = Decimal("1500.00")
        account.currency = "EUR"
        yield account


def connector_with(backend: FakeBackend, interaction: ScriptedInteraction | None) -> WoobConnector:
    connector = object.__new__(WoobConnector)
    connector._backend = backend
    connector._interaction = interaction
    connector._woob_accounts = {}
    return connector


def test_account_mapping_keeps_french_subtype() -> None:
    woob_account = WoobAccount(id="42")
    woob_account.label = "PEA"
    woob_account.type = AccountType.PEA
    woob_account.balance = Decimal("10.50")
    woob_account.currency = "EUR"
    woob_account.opening_date = datetime(2019, 3, 1, 12, 0)
    woob_account.number = NotAvailable

    account = account_from_woob(woob_account)

    assert account.kind is AccountKind.PEA
    assert account.subtype == "PEA"
    assert account.balance == Decimal("10.50")
    assert account.opening_date == date(2019, 3, 1)
    assert account.number is None


def test_unknown_account_type_maps_to_other() -> None:
    woob_account = WoobAccount(id="1")
    woob_account.type = AccountType.UNKNOWN
    assert account_from_woob(woob_account).kind is AccountKind.OTHER


def test_holding_isin_only_when_code_is_an_isin() -> None:
    investment = Investment()
    investment.label = "Fonds euro"
    investment.code = "QS0002005324"
    investment.code_type = Investment.CODE_TYPE_AMF
    investment.valuation = Decimal("1000")

    assert holding_from_woob(investment, "EUR").isin is None

    investment.code = "FR0010315770"
    investment.code_type = Investment.CODE_TYPE_ISIN
    holding = holding_from_woob(investment, "EUR")
    assert holding.isin == "FR0010315770"
    assert holding.currency == "EUR"


def test_transaction_without_amount_is_dropped() -> None:
    transaction = WoobTransaction()
    transaction.date = date(2026, 1, 2)
    transaction.amount = NotAvailable
    assert transaction_from_woob(transaction, "EUR") is None

    transaction.amount = Decimal("-12.30")
    transaction.raw = "CB CARREFOUR"
    converted = transaction_from_woob(transaction, "EUR")
    assert converted is not None
    assert converted.label == "CB CARREFOUR"


def test_password_fields_are_secret() -> None:
    assert prompt_from_value(ValueBackendPassword("password", label="Password")).secret
    assert not prompt_from_value(ValueBackendPassword("login", label="Login", masked=False)).secret
    assert prompt_from_value(Value("broker", choices=["linxea", "other"])).choices == ("linxea", "other")


def test_sms_question_is_answered_then_retried() -> None:
    backend = FakeBackend(BrowserQuestion(backend_value := ValueTransient("otp_sms", label="SMS code")))
    interaction = ScriptedInteraction("123456")

    accounts = connector_with(backend, interaction).accounts()

    assert [account.external_id for account in accounts] == ["123"]
    assert interaction.prompts[0].label == backend_value.label
    assert backend.config["otp_sms"].get() == "123456"
    assert backend.calls == 2


def test_app_validation_notifies_and_resumes() -> None:
    backend = FakeBackend(DecoupledValidation("Validate the login in your bank's app"))
    interaction = ScriptedInteraction()

    connector_with(backend, interaction).accounts()

    assert interaction.messages == ["Validate the login in your bank's app"]
    assert backend.config["resume"].get() is True


def test_challenge_without_user_requires_interaction() -> None:
    backend = FakeBackend(BrowserQuestion(ValueTransient("otp_sms")))
    with pytest.raises(ConnectorError) as error:
        connector_with(backend, None).accounts()
    assert error.value.code is ErrorCode.INTERACTION_REQUIRED


@pytest.mark.parametrize(
    ("raised", "code"),
    [
        (BrowserIncorrectPassword("bad"), ErrorCode.INVALID_CREDENTIALS),
        (ScrapingBlocked("waf"), ErrorCode.BLOCKED),
        (NotImplementedError(), ErrorCode.NOT_SUPPORTED),
        (KeyError("boom"), ErrorCode.UNEXPECTED),
    ],
)
def test_woob_errors_become_stable_codes(raised: Exception, code: ErrorCode) -> None:
    with pytest.raises(ConnectorError) as error:
        connector_with(FakeBackend(raised), ScriptedInteraction()).accounts()
    assert error.value.code is code


def test_endless_challenges_stop() -> None:
    backend = FakeBackend(*[DecoupledValidation("again") for _ in range(10)])
    with pytest.raises(ConnectorError) as error:
        connector_with(backend, ScriptedInteraction()).accounts()
    assert error.value.code is ErrorCode.INTERACTION_REQUIRED


@pytest.mark.skipif(not paths.woob_modules_dir().is_dir(), reason="Woob modules not installed")
@pytest.mark.parametrize(
    "module",
    [
        "spirica",
        "suravenir",
        "boursorama",
        "boursedirect",
        "swisslife",
        "abeilleassurances",
        "apivie",
        "wiseed",
    ],
)
def test_catalog_modules_load(module: str) -> None:
    keys = [prompt.key for prompt in config_prompts(module)]
    assert "login" in keys and "password" in keys


@pytest.mark.skipif(not paths.woob_modules_dir().is_dir(), reason="Woob modules not installed")
def test_login_format_is_exposed_and_enforced() -> None:
    login = next(prompt for prompt in config_prompts("boursorama") if prompt.key == "login")
    assert login.pattern == "^[0-9]+$"

    with pytest.raises(ConnectorError) as error:
        WoobConnector("boursorama", {"login": "not-digits", "password": "x"})
    assert error.value.code is ErrorCode.INVALID_INPUT


def test_login_and_password_are_required() -> None:
    assert prompt_from_value(ValueBackendPassword("login", masked=False)).required
    assert prompt_from_value(ValueBackendPassword("password")).required
    assert not prompt_from_value(Value("identity", required=False)).required
