import type { EngineStatus } from "@kerfin/core";
import { useCallback, useEffect, useState } from "react";

import { engine, onLocked } from "./engine";
import { t } from "./i18n";
import { Shell } from "./screens/Shell";
import { VaultScreen } from "./screens/VaultScreen";
import { useUpdater } from "./updater";

export function App() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await engine.status());
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Notice an automatic lock even when the user isn't clicking anything.
    const timer = setInterval(() => void refresh(), 30_000);
    const unsubscribe = onLocked(() => void refresh());
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [refresh]);

  // Updating while locked loses nothing, so it happens on its own.
  const updater = useUpdater(status !== null && status.vault !== "unlocked");

  if (updater.state.kind === "installing") {
    return <CenterMessage text={t("update.installing")} spinner />;
  }
  if (unreachable && !status) {
    return (
      <CenterMessage text={t("app.engineDown")}>
        <button className="btn" onClick={() => void refresh()}>
          {t("app.retry")}
        </button>
      </CenterMessage>
    );
  }
  if (!status) return <CenterMessage text={t("app.loading")} spinner />;
  if (status.vault !== "unlocked") return <VaultScreen mode={status.vault} onDone={setStatus} />;
  return <Shell status={status} onStatus={setStatus} updater={updater} />;
}

function CenterMessage({ text, spinner, children }: { text: string; spinner?: boolean; children?: React.ReactNode }) {
  return (
    <div className="center-screen">
      <div className="row" style={{ flexDirection: "column", gap: 14 }}>
        {spinner && <div className="spinner" />}
        <div className="secondary">{text}</div>
        {children}
      </div>
    </div>
  );
}
