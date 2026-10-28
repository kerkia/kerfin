// Connecting Finary: the user signs in on Finary's page in their browser and approves
// read-only access; the engine receives the result and starts the first import.
import { useEffect, useState } from "react";

import { EngineError, engine } from "../engine";
import { errorText, t } from "../i18n";
import { useJobs } from "./Jobs";

const POLL_MS = 1000;

export function FinaryConnect({
  connectionId,
  onBack,
  onDone,
}: {
  connectionId?: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { track } = useJobs();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      const status = await engine.finarySignInStatus().catch(() => null);
      if (stopped) return;
      if (status?.state === "done" && status.job) {
        track(status.job, "Finary");
        onDone();
      } else if (status?.state === "failed") {
        setError(errorText(status.error?.code));
        setUrl(null);
      } else {
        setTimeout(poll, POLL_MS);
      }
    };
    setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
    };
  }, [url, track, onDone]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setUrl((await engine.finarySignIn(connectionId)).url);
    } catch (e) {
      setError(e instanceof EngineError ? errorText(e.code) : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(url ?? "").catch(() => undefined);
    setCopied(true);
  }

  return (
    <div className="form">
      <h2>{t("finary.title")}</h2>
      {url ? (
        <>
          <div className="row">
            <div className="spinner" />
            <span>{t("finary.waiting")}</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {t("finary.noBrowser")}
          </p>
          <div className="row">
            <code className="small finary-url">{url}</code>
            <button type="button" className="btn small" onClick={() => void copy()}>
              {copied ? t("finary.copied") : t("finary.copy")}
            </button>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setUrl(null)}>
              {t("add.cancel")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="secondary" style={{ margin: 0 }}>
            {t("finary.intro")}
          </p>
          <p className="secondary" style={{ margin: 0 }}>
            {t("finary.how")}
          </p>
          {error && <div className="error-text">{error}</div>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onBack}>
              {connectionId ? t("add.cancel") : t("add.back")}
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>
              {t("finary.signIn")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
