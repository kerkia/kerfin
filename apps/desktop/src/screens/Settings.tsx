import type { EngineStatus } from "@kerfin/core";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { EngineError, engine } from "../engine";
import { errorText, t, timeOfDay } from "../i18n";
import type { useUpdater } from "../updater";
import { MIN_LENGTH, useUnlockWait } from "./VaultScreen";

const AUTO_LOCK_CHOICES = [5, 15, 30, 60];

export function Settings({
  status,
  onStatus,
  updater,
}: {
  status: EngineStatus;
  onStatus: (status: EngineStatus) => void;
  updater: ReturnType<typeof useUpdater>;
}) {
  const [appVersion, setAppVersion] = useState("dev");
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (isTauri()) getVersion().then(setAppVersion, () => undefined);
  }, []);

  async function checkUpdates() {
    setChecking(true);
    // Shown for a moment at least: an instant answer would look like nothing happened.
    await Promise.all([updater.checkNow(), new Promise((resolve) => setTimeout(resolve, 600))]);
    setChecking(false);
    setCheckedAt(new Date());
  }

  return (
    <>
      <h1>{t("settings.title")}</h1>

      <section className="card form">
        <h2>{t("settings.security")}</h2>
        <p className="secondary" style={{ margin: 0 }}>
          {t("settings.storage")}
        </p>
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="auto-lock">{t("settings.autoLock")}</label>
          <select
            id="auto-lock"
            className="input"
            value={status.auto_lock_minutes ?? 15}
            onChange={async (e) => onStatus(await engine.setAutoLock(Number(e.target.value)))}
          >
            {AUTO_LOCK_CHOICES.map((n) => (
              <option key={n} value={n}>
                {t("settings.minutes", { n })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button className="btn" onClick={async () => onStatus(await engine.lock())}>
            {t("settings.lockNow")}
          </button>
        </div>
      </section>

      <ChangePassphrase status={status} onStatus={onStatus} />

      <section className="card form">
        <h2>{t("settings.updates")}</h2>
        {updater.state.kind === "unsupported" ? (
          <p className="muted" style={{ margin: 0 }}>
            {t("settings.updatesDev")}
          </p>
        ) : (
          <>
            {updater.state.kind === "available" && (
              <p style={{ margin: 0 }}>{t("settings.updateReady", { version: updater.state.version })}</p>
            )}
            {updater.state.kind === "error" && (
              <p className="error-text" style={{ margin: 0 }}>
                {t("update.failed", { error: updater.state.message })}
              </p>
            )}
            {checkedAt && !checking && updater.state.kind === "idle" && (
              <p style={{ margin: 0 }}>{t("settings.upToDate", { time: timeOfDay(checkedAt) })}</p>
            )}
            <div>
              <button className="btn" disabled={checking} onClick={() => void checkUpdates()}>
                {checking ? t("settings.checking") : t("settings.checkUpdates")}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card form">
        <h2>{t("settings.about")}</h2>
        <p className="secondary" style={{ margin: 0 }}>
          {t("settings.version", { app: appVersion, engine: status.version })}
        </p>
      </section>
    </>
  );
}

function ChangePassphrase({ status, onStatus }: { status: EngineStatus; onStatus: (status: EngineStatus) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const unlockWait = useUnlockWait(status.unlock_wait);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setDone(false);
    if (next !== confirm) {
      setError(t("vault.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onStatus(await engine.changePassphrase(current, next));
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (e) {
      const code = e instanceof EngineError ? e.code : "unexpected";
      if (code === "wrong_passphrase" || code === "too_many_attempts") await unlockWait.restart();
      setError(
        code === "wrong_passphrase"
          ? t("vault.wrong")
          : code === "too_many_attempts"
            ? null
            : (e as EngineError).detail || errorText(code),
      );
    }
    setBusy(false);
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{t("settings.passphrase")}</h2>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="current-passphrase">{t("settings.currentPassphrase")}</label>
        <input
          id="current-passphrase"
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="new-passphrase">{t("settings.newPassphrase")}</label>
        <input
          id="new-passphrase"
          className="input"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <span className="muted small">{t("vault.minLength", { n: MIN_LENGTH })}</span>
      </div>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="confirm-passphrase">{t("settings.confirmPassphrase")}</label>
        <input
          id="confirm-passphrase"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <div className="error-text">{error}</div>}
      {unlockWait.message && <div className="error-text">{unlockWait.message}</div>}
      {done && <p style={{ margin: 0 }}>{t("settings.passphraseChanged")}</p>}
      <div>
        <button
          className="btn"
          type="submit"
          disabled={busy || !current || next.length < MIN_LENGTH || !confirm || unlockWait.left > 0}
        >
          {t("settings.changePassphrase")}
        </button>
      </div>
    </form>
  );
}
