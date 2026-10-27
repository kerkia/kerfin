import type { EngineStatus } from "@kerfin/core";
import { useState } from "react";

import { EngineError, engine } from "../engine";
import { errorText, t } from "../i18n";

const MIN_LENGTH = 10; // kerfin_engine.vault.MIN_PASSPHRASE_LENGTH

export function VaultScreen({
  mode,
  onDone,
}: {
  mode: "missing" | "locked";
  onDone: (status: EngineStatus) => void;
}) {
  const creating = mode === "missing";
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      setError(code === "wrong_passphrase" ? t("vault.wrong") : (e as EngineError).detail || errorText(code));
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
        <button
          className="btn primary"
          disabled={busy || passphrase.length < (creating ? MIN_LENGTH : 1)}
          type="submit"
        >
          {creating ? t("vault.create") : t("vault.unlock")}
        </button>
      </form>
    </div>
  );
}
