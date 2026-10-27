import type { EngineStatus } from "@kerfin/core";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { engine } from "../engine";
import { t } from "../i18n";
import type { useUpdater } from "../updater";

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
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isTauri()) getVersion().then(setAppVersion, () => undefined);
  }, []);

  async function checkUpdates() {
    await updater.checkNow();
    setChecked(true);
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

      <section className="card form">
        <h2>{t("settings.updates")}</h2>
        {updater.state.kind === "unsupported" ? (
          <p className="muted" style={{ margin: 0 }}>
            {t("settings.updatesDev")}
          </p>
        ) : (
          <>
            {updater.state.kind === "available" && (
              <div className="banner">
                <span>{t("update.available", { version: updater.state.version })}</span>
                <button className="btn small" onClick={() => void updater.installNow()}>
                  {t("update.install")}
                </button>
              </div>
            )}
            {updater.state.kind === "error" && (
              <p className="error-text" style={{ margin: 0 }}>
                {t("update.failed", { error: updater.state.message })}
              </p>
            )}
            {checked && updater.state.kind === "idle" && <p style={{ margin: 0 }}>{t("settings.upToDate")}</p>}
            <div>
              <button className="btn" onClick={() => void checkUpdates()}>
                {t("settings.checkUpdates")}
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
