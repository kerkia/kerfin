import type { EngineStatus } from "@kerfin/core";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { EngineError, engine } from "../engine";
import { countdown, errorText, t } from "../i18n";

export const MIN_LENGTH = 8; // kerfin_engine.vault.MIN_PASSPHRASE_LENGTH

/**
 * Seconds left before a passphrase may be tried again, counted down from what the engine
 * said; `restart` takes a new figure from it after a wrong passphrase.
 */
export function useUnlockWait(seconds: number) {
  const [until, setUntil] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setUntil(Date.now() + seconds * 1000);
    setNow(Date.now());
  }, [seconds]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  const waiting = left > 0;
  useEffect(() => {
    if (!waiting) return;
    // From the clock, not by counting ticks: timers slow down while the window is hidden.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  const restart = async () => {
    const status = await engine.status().catch(() => null);
    if (status) {
      setUntil(Date.now() + status.unlock_wait * 1000);
      setNow(Date.now());
    }
  };
  return { left, message: waiting ? t("vault.wait", { time: countdown(left) }) : null, restart };
}

/**
 * Puts the cursor in the passphrase field. At launch the window itself doesn't have the
 * keyboard yet (WebView2 waits for a click), so the desktop app asks for it first, but only
 * when the window is already the active one: locking while another app is in front must not
 * bring Kerfin over it. The field takes the focus back whenever the window gets it.
 */
function useStartFocus(input: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const focus = () => {
      if (document.activeElement === document.body || document.activeElement === null) input.current?.focus();
    };
    if (isTauri()) {
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const current = getCurrentWindow();
          if (await current.isFocused()) await current.setFocus();
        })
        .catch(() => undefined)
        .finally(() => input.current?.focus());
    }
    input.current?.focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [input]);
}

export function VaultScreen({
  mode,
  wait,
  onDone,
}: {
  mode: "missing" | "locked";
  wait: number;
  onDone: (status: EngineStatus) => void;
}) {
  const creating = mode === "missing";
  const [passphrase, setPassphrase] = useState("");
  const passphraseInput = useRef<HTMLInputElement>(null);
  useStartFocus(passphraseInput);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unlockWait = useUnlockWait(wait);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (creating && passphrase !== confirm) {
      setError(t("vault.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(creating ? await engine.createVault(passphrase) : await engine.unlock(passphrase));
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
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card vault-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" />
          Kerfin
        </div>
        <h1>{creating ? t("vault.createTitle") : t("vault.unlockTitle")}</h1>
        <p className="secondary" style={{ margin: 0 }}>
          {creating ? t("vault.createIntro") : t("vault.unlockIntro")}
        </p>
        {creating && <div className="banner">{t("vault.createWarning")}</div>}
        <div className="field">
          <label htmlFor="passphrase">{t("vault.passphrase")}</label>
          <input
            id="passphrase"
            ref={passphraseInput}
            className="input"
            type="password"
            autoFocus
            autoComplete={creating ? "new-password" : "current-password"}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          {creating && <span className="muted small">{t("vault.minLength", { n: MIN_LENGTH })}</span>}
        </div>
        {creating && (
          <div className="field">
            <label htmlFor="confirm">{t("vault.confirm")}</label>
            <input
              id="confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        {!creating && unlockWait.message && <div className="error-text">{unlockWait.message}</div>}
        <button
          className="btn primary"
          disabled={busy || passphrase.length < (creating ? MIN_LENGTH : 1) || (!creating && unlockWait.left > 0)}
          type="submit"
        >
          {creating ? t("vault.create") : t("vault.unlock")}
        </button>
      </form>
    </div>
  );
}
