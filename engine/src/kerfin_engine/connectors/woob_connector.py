"""Connector for the institutions supported by Woob (scraping of bank and insurer websites)."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from datetime import date, datetime
from importlib import metadata
from importlib.machinery import ModuleSpec
from itertools import islice
from pathlib import Path
from typing import Any

import requests
from packaging.version import Version
from woob import __version__ as woob_version
from woob.capabilities.bank import Account as WoobAccount
from woob.capabilities.bank import AccountType
from woob.capabilities.bank.wealth import CapBankWealth, Investment
from woob.capabilities.base import empty
from woob.core.modules import LoadedModule, ModulesLoader
from woob.core.woob import WoobBase
from woob.exceptions import (
    ActionNeeded,
    AppValidationError,
    BrowserForbidden,
    BrowserIncorrectPassword,
    BrowserQuestion,
    BrowserRedirect,
    BrowserUnavailable,
    CaptchaQuestion,
    DecoupledValidation,
    ModuleLoadError,
    NeedInteractive,
    ScrapingBlocked,
)
from woob.tools.backend import Module
from woob.tools.packaging import parse_requirements
from woob.tools.value import Value, ValueBackendPassword, ValueTransient

from kerfin_engine import paths
from kerfin_engine.connectors.base import ConnectorError, ErrorCode, InteractionHandler, Prompt
from kerfin_engine.domain import Account, AccountKind, Holding, Transaction

# Woob enums are plain values (AccountType.PEA is an int), not Python Enum members.
_WOOB_TYPE_NAMES: dict[Any, str] = {value: name for name, value in AccountType.__members__.items()}

_KIND_BY_WOOB_TYPE: dict[Any, AccountKind] = {
    AccountType.CHECKING: AccountKind.CHECKING,
    AccountType.JOINT: AccountKind.CHECKING,
    AccountType.CARD: AccountKind.CARD,
    AccountType.SAVINGS: AccountKind.SAVINGS,
    AccountType.DEPOSIT: AccountKind.SAVINGS,
    AccountType.LIVRET_A: AccountKind.SAVINGS,
    AccountType.LIVRET_B: AccountKind.SAVINGS,
    AccountType.LDDS: AccountKind.SAVINGS,
    AccountType.PEL: AccountKind.SAVINGS,
    AccountType.CEL: AccountKind.SAVINGS,
    AccountType.CSL: AccountKind.SAVINGS,
    AccountType.CAT: AccountKind.SAVINGS,
    AccountType.LIFE_INSURANCE: AccountKind.LIFE_INSURANCE,
    AccountType.CAPITALISATION: AccountKind.LIFE_INSURANCE,
    AccountType.PER: AccountKind.RETIREMENT,
    AccountType.PERP: AccountKind.RETIREMENT,
    AccountType.PERCO: AccountKind.RETIREMENT,
    AccountType.MADELIN: AccountKind.RETIREMENT,
    AccountType.RSP: AccountKind.RETIREMENT,
    AccountType.PEA: AccountKind.PEA,
    AccountType.MARKET: AccountKind.SECURITIES,
    AccountType.PEE: AccountKind.EMPLOYEE_SAVINGS,
    AccountType.CROWDLENDING: AccountKind.CROWDFUNDING,
    AccountType.REAL_ESTATE: AccountKind.REAL_ESTATE,
    AccountType.LOAN: AccountKind.LOAN,
    AccountType.MORTGAGE: AccountKind.LOAN,
    AccountType.CONSUMER_CREDIT: AccountKind.LOAN,
    AccountType.REVOLVING_CREDIT: AccountKind.LOAN,
}


class _ModulesLoader(ModulesLoader):
    """Loads modules from a local folder, tolerating requirements that Woob mislabels."""

    # Module requirement name -> distribution actually providing it.
    REQUIREMENT_ALIASES = {"jwt": "pyjwt"}

    def check_version(self, module_name: str, module_spec: ModuleSpec) -> None:
        if module_spec.origin is None:
            return
        requirements = parse_requirements(Path(module_spec.origin).parent / "requirements.txt")
        for name, spec in requirements.items():
            if name == "woob":
                if self.version and Version(self.version) not in spec:
                    raise ModuleLoadError(module_name, f"Module requires woob {spec}, not {self.version}")
                continue
            distribution = self.REQUIREMENT_ALIASES.get(name, name)
            try:
                installed = metadata.version(distribution)
            except metadata.PackageNotFoundError as exc:
                raise ModuleLoadError(module_name, f'Module requires python package "{name}"') from exc
            if distribution == name and Version(installed) not in spec:
                raise ModuleLoadError(module_name, f'Module requires "{name}" {spec}, not {installed}')


class _Woob(WoobBase):
    def build_modules_loader(self) -> ModulesLoader:
        return _ModulesLoader(self.modules_path, woob_version)


def _woob(modules_dir: Path | None) -> _Woob:
    modules_dir = modules_dir or paths.woob_modules_dir()
    if not modules_dir.is_dir():
        raise ConnectorError(
            ErrorCode.CONNECTOR_UNAVAILABLE,
            f"Woob modules not found in {modules_dir}; run `kerfin-engine woob-modules --install`",
        )
    return _Woob(modules_path=str(modules_dir))


def _load_module(woob: _Woob, module: str) -> LoadedModule:
    try:
        return woob.modules_loader.get_or_load_module(module)
    except ModuleLoadError as exc:
        raise ConnectorError(ErrorCode.CONNECTOR_UNAVAILABLE, str(exc)) from exc


def config_prompts(
    module: str, fixed: Mapping[str, str] | None = None, modules_dir: Path | None = None
) -> list[Prompt]:
    """The settings a user must fill in to connect with `module` (login, password...)."""
    loaded = _load_module(_woob(modules_dir), module)
    return [
        prompt_from_value(value)
        for key, value in loaded.config.items()
        if key not in (fixed or {}) and not isinstance(value, ValueTransient)
    ]


def prompt_from_value(value: Value[Any]) -> Prompt:
    default = value.default if not empty(value.default) and value.default != "" else None
    return Prompt(
        key=value.id,
        label=value.label or value.description or value.id,
        secret=bool(getattr(value, "masked", False)),
        choices=tuple(value.choices or ()),
        default=None if default is None else str(default),
        # Woob marks logins and passwords optional (their default is ""), yet no login works without them.
        required=bool(getattr(value, "required", True))
        or (isinstance(value, ValueBackendPassword) and not value.noprompt),
        pattern=value.regexp or None,
    )


def translate_error(error: Exception) -> ConnectorError:
    # Order matters: several of these classes inherit from one another.
    if isinstance(error, ConnectorError):
        return error
    if isinstance(error, Module.ConfigError):
        code = ErrorCode.INVALID_INPUT
    elif isinstance(error, BrowserIncorrectPassword):
        code = ErrorCode.INVALID_CREDENTIALS
    elif isinstance(error, ActionNeeded):
        code = ErrorCode.ACTION_NEEDED
    elif isinstance(error, (NeedInteractive, BrowserQuestion, DecoupledValidation, BrowserRedirect)):
        code = ErrorCode.INTERACTION_REQUIRED
    elif isinstance(error, AppValidationError):
        code = ErrorCode.VALIDATION_FAILED
    elif isinstance(error, CaptchaQuestion):
        code = ErrorCode.CAPTCHA
    elif isinstance(error, (ScrapingBlocked, BrowserForbidden)):
        code = ErrorCode.BLOCKED
    elif isinstance(error, requests.exceptions.SSLError):
        code = ErrorCode.INSECURE_CONNECTION
    elif isinstance(error, (BrowserUnavailable, ConnectionError, requests.exceptions.RequestException)):
        code = ErrorCode.SITE_UNAVAILABLE
    elif isinstance(error, NotImplementedError):
        code = ErrorCode.NOT_SUPPORTED
    else:
        return ConnectorError(ErrorCode.UNEXPECTED, f"{type(error).__name__}: {error}")
    return ConnectorError(code, str(error))


def _opt(value: Any) -> Any:
    return None if empty(value) else value


def _date(value: Any) -> date | None:
    value = _opt(value)
    return value.date() if isinstance(value, datetime) else value


def account_from_woob(account: WoobAccount) -> Account:
    woob_type = _opt(account.type)
    return Account(
        external_id=str(account.id),
        label=_opt(account.label) or str(account.id),
        kind=_KIND_BY_WOOB_TYPE.get(woob_type, AccountKind.OTHER),
        balance=_opt(account.balance),
        currency=_opt(account.currency),
        subtype=_WOOB_TYPE_NAMES.get(woob_type),
        number=_opt(account.number),
        opening_date=_date(account.opening_date),
    )


def holding_from_woob(investment: Investment, account_currency: str | None) -> Holding:
    code = _opt(investment.code)
    return Holding(
        label=_opt(investment.label) or code or "?",
        valuation=_opt(investment.valuation),
        currency=account_currency,
        isin=code if _opt(investment.code_type) == Investment.CODE_TYPE_ISIN else None,
        quantity=_opt(investment.quantity),
        unit_value=_opt(investment.unitvalue),
        unit_price=_opt(investment.unitprice),
        value_date=_date(investment.vdate),
    )


def transaction_from_woob(transaction: Any, account_currency: str | None) -> Transaction | None:
    """None when the website gave neither a date nor an amount we can use."""
    when = _date(transaction.date) or _date(transaction.rdate)
    amount = _opt(transaction.amount)
    if when is None or amount is None:
        return None
    return Transaction(
        date=when,
        label=_opt(transaction.label) or _opt(transaction.raw) or "",
        amount=amount,
        currency=account_currency,
        pending=bool(_opt(transaction.coming)),
    )


class WoobConnector:
    """One authenticated session on one Woob module.

    With an interaction handler, login challenges (SMS codes, app validation...) are
    forwarded to the user and the call is retried. Without one, the connector runs
    unattended and raises INTERACTION_REQUIRED instead of triggering a challenge.
    """

    MAX_CHALLENGES = 5

    def __init__(
        self,
        module: str,
        params: Mapping[str, str],
        interaction: InteractionHandler | None = None,
        modules_dir: Path | None = None,
    ) -> None:
        self._woob = _woob(modules_dir)
        _load_module(self._woob, module)
        try:
            self._backend = self._woob.build_backend(module, params=dict(params), name=module)
        except Exception as exc:
            raise translate_error(exc) from exc
        self._interaction = interaction
        # Woob convention: a non-None value means a user is present to answer challenges.
        if interaction is not None and "request_information" in self._backend.config:
            self._backend.config["request_information"].set({})
        self._woob_accounts: dict[str, WoobAccount] = {}

    def accounts(self) -> list[Account]:
        woob_accounts = self._call(self._backend.iter_accounts)
        self._woob_accounts = {str(account.id): account for account in woob_accounts}
        return [account_from_woob(account) for account in woob_accounts]

    def holdings(self, account_id: str) -> list[Holding]:
        account = self._woob_account(account_id)
        if not isinstance(self._backend, CapBankWealth):
            return []
        try:
            investments = self._call(self._backend.iter_investment, account)
        except ConnectorError as exc:
            if exc.code is ErrorCode.NOT_SUPPORTED:
                return []
            raise
        return [holding_from_woob(investment, _opt(account.currency)) for investment in investments]

    def transactions(self, account_id: str, limit: int | None = None) -> list[Transaction]:
        account = self._woob_account(account_id)
        try:
            history = self._call(self._backend.iter_history, account, limit=limit)
        except ConnectorError as exc:
            if exc.code is ErrorCode.NOT_SUPPORTED:
                return []
            raise
        currency = _opt(account.currency)
        converted = (transaction_from_woob(transaction, currency) for transaction in history)
        return [transaction for transaction in converted if transaction is not None]

    def close(self) -> None:
        self._backend.deinit()

    def _woob_account(self, account_id: str) -> WoobAccount:
        if not self._woob_accounts:
            self.accounts()
        try:
            return self._woob_accounts[account_id]
        except KeyError:
            raise ConnectorError(ErrorCode.UNEXPECTED, f"Unknown account {account_id}") from None

    def _call(self, method: Callable[..., Iterable[Any]], *args: Any, limit: int | None = None) -> list[Any]:
        """Run a Woob call, answering login challenges and retrying on the same session."""
        for _ in range(self.MAX_CHALLENGES + 1):
            try:
                return list(islice(method(*args), limit))
            except BrowserQuestion as question:
                interaction = self._require_interaction(question)
                for field in question.fields:
                    answer = interaction.ask(prompt_from_value(field))
                    try:
                        self._backend.config[field.id].set(answer)
                    except ValueError as exc:
                        raise ConnectorError(ErrorCode.INVALID_INPUT, str(exc)) from exc
            except DecoupledValidation as validation:
                self._require_interaction(validation).notify(validation.message)
                # Retrying with "resume" set makes the module wait for the validation.
                if "resume" in self._backend.config:
                    self._backend.config["resume"].set(True)
            except BrowserRedirect as redirect:
                interaction = self._require_interaction(redirect)
                interaction.notify(f"Open this address in a browser and log in: {redirect.url}")
                answer = interaction.ask(Prompt(key="auth_uri", label="Address shown after logging in"))
                self._backend.config["auth_uri"].set(answer)
            except Exception as exc:
                raise translate_error(exc) from exc
        raise ConnectorError(ErrorCode.INTERACTION_REQUIRED, "Too many login challenges in a row")

    def _require_interaction(self, challenge: Exception) -> InteractionHandler:
        if self._interaction is None:
            raise translate_error(challenge)
        return self._interaction
