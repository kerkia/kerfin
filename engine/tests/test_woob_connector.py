from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
import requests
from woob.capabilities.bank import Account as WoobAccount
from woob.capabilities.bank import AccountType
from woob.capabilities.bank import Transaction as WoobTransaction
from woob.capabilities.bank.wealth import Investment
from woob.capabilities.base import NotAvailable
from woob.exceptions import (
    AuthMethodNotImplemented,
    BrowserIncorrectPassword,
    BrowserQuestion,
    DecoupledValidation,
    ScrapingBlocked,
)
from woob.tools.value import Value, ValueBackendPassword, ValueTransient

from kerfin_engine import paths
from kerfin_engine.connectors import ConnectorError, ErrorCode, Prompt, woob_fixes
from kerfin_engine.connectors.woob_connector import (
    WoobConnector,
    account_from_woob,
    bank_modules,
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
        self.qr_codes: list[str | None] = []

    def ask(self, prompt: Prompt) -> str:
        self.prompts.append(prompt)
        return self.answers.pop(0)

    def notify(self, message: str) -> None:
        self.messages.append(message)

    def show_qr_code(self, data: str | None) -> None:
        self.qr_codes.append(data)


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


def http_error(status: int) -> requests.exceptions.HTTPError:
    response = requests.Response()
    response.status_code = status
    return requests.exceptions.HTTPError(f"{status} error", response=response)


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
        (http_error(403), ErrorCode.BLOCKED),
        (http_error(503), ErrorCode.SITE_UNAVAILABLE),
        (requests.exceptions.ConnectionError("reset by peer"), ErrorCode.CONNECTION_FAILED),
        (requests.exceptions.SSLError("UNEXPECTED_EOF_WHILE_READING"), ErrorCode.CONNECTION_FAILED),
        (requests.exceptions.SSLError("[SSL: CERTIFICATE_VERIFY_FAILED]"), ErrorCode.INSECURE_CONNECTION),
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


class FakeBoursoBankBrowser:
    """Polls like Woob's BoursoBank module: until success, giving up on a QR code."""

    def __init__(self, *responses: dict[str, Any]) -> None:
        self.responses = list(responses)
        self.page: Any = None

    def check_twofa_status(self, token: str | None = None) -> None:
        self.page = SimpleNamespace(doc=self.responses.pop(0))

    def handle_polling(self) -> None:
        while True:
            self.check_twofa_status()
            if self.page.doc.get("success"):
                return
            if self.page.doc.get("qrcode"):
                raise AuthMethodNotImplemented("La validation par QR code n'est pas encore prise en charge.")


def test_boursobank_qr_code_is_shown_and_polling_goes_on() -> None:
    backend = SimpleNamespace(BROWSER=FakeBoursoBankBrowser)
    interaction = ScriptedInteraction()
    woob_fixes.apply("boursorama", backend, interaction)  # type: ignore[arg-type]

    backend.BROWSER(
        {"success": False}, {"qrcode": "code-1"}, {"qrcode": "code-2"}, {"success": True}
    ).handle_polling()

    assert interaction.qr_codes == ["code-1", "code-2", None]


@pytest.mark.skipif(not paths.woob_modules_dir().is_dir(), reason="Woob modules not installed")
def test_unused_boursobank_identity_is_not_asked() -> None:
    assert "identity" not in [prompt.key for prompt in config_prompts("boursorama")]


@pytest.mark.skipif(not paths.woob_modules_dir().is_dir(), reason="Woob modules not installed")
def test_bank_modules_include_major_banks() -> None:
    modules = {module["module"] for module in bank_modules()}
    assert {
        "boursorama",
        "bnp",
        "societegenerale",
        "creditmutuel",
        "caissedepargne",
        "banquepopulaire",
    } <= modules
    assert "linebourse" not in modules  # a building block of other modules, without settings


SYLVEA_LOGIN_FORM = """<html><body>
<form id="loginForm" name="loginForm" method="post" action="/securite/login.xhtml?cid=1">
<input type="hidden" name="loginForm" value="loginForm" />
<input id="loginForm:name" type="text" name="loginForm:name" value="" />
<input id="loginForm:password" type="password" name="loginForm:password" value="" />
<input id="loginForm:testLogin" type="submit" name="loginForm:testLogin" value="Se connecter" />
<input type="hidden" name="jakarta.faces.ViewState" value="state" />
</form></body></html>"""


@pytest.mark.skipif(not paths.woob_modules_dir().is_dir(), reason="Woob modules not installed")
def test_spirica_login_submits_the_current_button(monkeypatch: pytest.MonkeyPatch) -> None:
    connector = WoobConnector("spirica", {"login": "user", "password": "secret"})
    browser = connector._backend.browser
    response = requests.Response()
    response._content = SYLVEA_LOGIN_FORM.encode()
    response.url = "https://www.sylvea.fr/securite/login.xhtml"
    response.headers["Content-Type"] = "text/html"
    response.encoding = "utf-8"
    sent: list[requests.Request] = []
    monkeypatch.setattr(browser, "location", lambda request, **_: sent.append(request))

    browser.login.klass(browser, response).login("user", "secret")

    assert sent[0].data["loginForm:testLogin"] == "Se connecter"
    assert sent[0].data["loginForm:name"] == "user" and "loginForm:login" not in sent[0].data
