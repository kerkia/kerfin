import type { EngineStatus } from "@kerfin/core";
import { useState } from "react";

import { JobsProvider } from "../components/Jobs";
import { RefreshOnStart } from "../components/RefreshOnStart";
import { DataProvider } from "../data";
import { engine } from "../engine";
import { t } from "../i18n";
import type { useUpdater } from "../updater";
import { Accounts } from "./Accounts";
import { InvestmentsPage } from "./Investments";
import { OverviewPage } from "./Overview";
import { Settings } from "./Settings";

type Page = "overview" | "investments" | "accounts" | "settings";

/** Pinned above every page while an update waits for a restart (or is being installed). */
function UpdateBar({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  const { state } = updater;
  if (state.kind !== "available" && state.kind !== "installing") return null;
  return (
    <div className="update-bar" role="status">
      <span>
        {state.kind === "available" ? t("update.available", { version: state.version }) : t("update.installing")}
      </span>
      {state.kind === "available" && (
        <button className="btn small primary" onClick={() => void updater.installNow()}>
          {t("update.install")}
        </button>
      )}
    </div>
  );
}

export function Shell({
  status,
  onStatus,
  updater,
}: {
  status: EngineStatus;
  onStatus: (status: EngineStatus) => void;
  updater: ReturnType<typeof useUpdater>;
}) {
  const [page, setPage] = useState<Page>("overview");
  const lock = async () => onStatus(await engine.lock());

  return (
    <DataProvider>
      <JobsProvider>
        <RefreshOnStart />
        <div className="shell">
          <nav className="sidebar">
            <div className="brand">
              <span className="brand-mark" />
              Kerfin
            </div>
            {(["overview", "investments", "accounts", "settings"] as const).map((id) => (
              <button
                key={id}
                className={page === id ? "nav-item active" : "nav-item"}
                aria-current={page === id ? "page" : undefined}
                onClick={() => setPage(id)}
              >
                {t(`nav.${id}`)}
              </button>
            ))}
            <div className="sidebar-footer">
              <button className="nav-item" onClick={() => void lock()}>
                {t("nav.lock")}
              </button>
            </div>
          </nav>
          <main className="main">
            <UpdateBar updater={updater} />
            <div className="page">
              {page === "overview" && <OverviewPage onNavigate={setPage} />}
              {page === "investments" && <InvestmentsPage />}
              {page === "accounts" && <Accounts />}
              {page === "settings" && <Settings status={status} onStatus={onStatus} updater={updater} />}
            </div>
          </main>
        </div>
      </JobsProvider>
    </DataProvider>
  );
}
