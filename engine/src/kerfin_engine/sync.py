"""Collecting data from institutions in background jobs that can ask the user questions.

A job runs in its own thread. When the website asks for something (an SMS code, the
password when it isn't remembered...), the job pauses in the `waiting` state with a
prompt; the UI shows it and posts the answer back.
"""

from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

from kerfin_engine import institutions
from kerfin_engine.connectors import registry
from kerfin_engine.connectors.base import ConnectorError, ErrorCode, Prompt
from kerfin_engine.domain import AccountKind
from kerfin_engine.store import Store, new_id

log = logging.getLogger(__name__)

# Account kinds whose detail (funds, shares...) is worth collecting.
WEALTH_KINDS = {
    AccountKind.LIFE_INSURANCE,
    AccountKind.RETIREMENT,
    AccountKind.PEA,
    AccountKind.SECURITIES,
    AccountKind.EMPLOYEE_SAVINGS,
    AccountKind.CROWDFUNDING,
}
TRANSACTIONS_PER_SYNC = 200
# Errors on an account's detail that leave the rest of the sync usable.
RECOVERABLE = {ErrorCode.SITE_UNAVAILABLE, ErrorCode.NOT_SUPPORTED, ErrorCode.UNEXPECTED}
ANSWER_TIMEOUT_SECONDS = 600


class JobState(StrEnum):
    RUNNING = "running"
    WAITING = "waiting"  # for the user to answer `prompt`
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class _Cancelled(Exception):
    pass


@dataclass
class Job:
    id: str
    connection_id: str
    state: JobState = JobState.RUNNING
    prompt: Prompt | None = None
    messages: list[str] = field(default_factory=list)
    error_code: str | None = None
    error_detail: str | None = None
    accounts_found: int = 0
    _answers: queue.Queue[str | None] = field(default_factory=queue.Queue, repr=False)

    # InteractionHandler

    def ask(self, prompt: Prompt) -> str:
        self.prompt, self.state = prompt, JobState.WAITING
        try:
            answer = self._answers.get(timeout=ANSWER_TIMEOUT_SECONDS)
        except queue.Empty:
            raise ConnectorError(ErrorCode.INTERACTION_REQUIRED, "No answer in time") from None
        finally:
            self.prompt = None
        if answer is None:
            raise _Cancelled()
        self.state = JobState.RUNNING
        return answer

    def notify(self, message: str) -> None:
        self.messages.append(message)

    # Called from the UI

    def answer(self, value: str) -> None:
        if self.state is not JobState.WAITING:
            raise ValueError("This job is not waiting for an answer")
        self._answers.put(value)

    def cancel(self) -> None:
        self._answers.put(None)

    @property
    def finished(self) -> bool:
        return self.state in (JobState.DONE, JobState.FAILED, JobState.CANCELLED)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "connection_id": self.connection_id,
            "state": self.state,
            "prompt": asdict(self.prompt) if self.prompt else None,
            "messages": self.messages,
            "error": {"code": self.error_code, "detail": self.error_detail} if self.error_code else None,
            "accounts_found": self.accounts_found,
        }


class SyncService:
    def __init__(self, store: Store, on_change: Callable[[], None]) -> None:
        self._store = store
        self._on_change = on_change  # persists the store
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def job(self, job_id: str) -> Job:
        return self._jobs[job_id]

    @property
    def busy(self) -> bool:
        return any(not job.finished for job in self._jobs.values())

    def start(self, connection_id: str, provided: dict[str, str] | None = None) -> Job:
        with self._lock:
            for job in self._jobs.values():
                if job.connection_id == connection_id and not job.finished:
                    return job
            job = Job(new_id(), connection_id)
            self._jobs[job.id] = job
        thread = threading.Thread(target=self._run, args=(job, provided or {}), daemon=True)
        thread.start()
        return job

    def cancel_all(self) -> None:
        for job in self._jobs.values():
            if not job.finished:
                job.cancel()

    def _run(self, job: Job, provided: dict[str, str]) -> None:
        connector = None
        try:
            connection = self._store.connection(job.connection_id)
            institution = institutions.get(connection["institution"])
            params = {**connection["params"], **self._store.secrets(job.connection_id), **provided}
            # Fields not remembered (typically the password) are asked at each sync.
            for prompt in registry.fields(institution):
                if prompt.key not in params and prompt.required:
                    params[prompt.key] = job.ask(prompt)

            connector = registry.open_connector(institution, params, job)
            collected = []
            for account in connector.accounts():
                holdings = None
                if account.kind in WEALTH_KINDS:
                    holdings = self._detail(job, account.label, connector.holdings, account.external_id)
                transactions = self._detail(
                    job, account.label, connector.transactions, account.external_id, TRANSACTIONS_PER_SYNC
                )
                collected.append((account, holdings, transactions or []))
            job.accounts_found = self._store.save_sync(job.connection_id, collected)
            self._store.record_sync(job.connection_id, "ok")
            job.state = JobState.DONE
        except _Cancelled:
            job.state = JobState.CANCELLED
        except ConnectorError as error:
            job.error_code, job.error_detail = error.code, error.detail
            job.state = JobState.FAILED
            self._record_failure(job.connection_id, error.code, error.detail)
        except Exception as error:  # a bug: report it rather than leave the job hanging
            log.exception("Sync failed")
            job.error_code, job.error_detail = ErrorCode.UNEXPECTED, f"{type(error).__name__}: {error}"
            job.state = JobState.FAILED
            self._record_failure(job.connection_id, ErrorCode.UNEXPECTED, job.error_detail)
        finally:
            if connector is not None:
                try:
                    connector.close()
                except Exception:
                    log.exception("Closing the connector failed")
            try:
                self._on_change()
            except Exception:
                log.exception("Saving after sync failed")

    @staticmethod
    def _detail(
        job: Job, account_label: str, fetch: Callable[..., list[Any]], *args: Any
    ) -> list[Any] | None:
        """Holdings or transactions of one account; a failure there shouldn't lose the balances."""
        try:
            return fetch(*args)
        except ConnectorError as error:
            if error.code in RECOVERABLE:
                log.warning("Detail of one account failed: %s", error.code)
                job.notify(f"{account_label}: {error.code}")
                return None
            raise

    def _record_failure(self, connection_id: str, code: str, detail: str) -> None:
        try:
            self._store.record_sync(connection_id, code, detail)
        except Exception:
            log.exception("Recording the sync failure failed")
