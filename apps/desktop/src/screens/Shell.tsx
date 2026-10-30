import type { EngineStatus } from "@kerfin/core";
import { useState } from "react";

import { JobsProvider } from "../components/Jobs";
import { RefreshOnStart } from "../components/RefreshOnStart";
import { DataProvider } from "../data";
import { engine } from "../engine";
import { t } from "../i18n";
import type { useUpdater } from "../updater";
import { useZoom } from "../zoom";
import { Accounts } from "./Accounts";
import { AccountTypesPage } from "./AccountTypes";
import { BudgetPage } from "./Budget";
import { FeesIncomePage } from "./FeesIncome";
import { InsurancePage } from "./Insurance";
import { InvestmentsPage } from "./Investments";
import { OverviewPage } from "./Overview";
import { Settings } from "./Settings";

type Page = "overview" | "budget" | "types" | "investments" | "income" | "insurance" | "accounts" | "settings";

/** The window's bottom row: an update waiting for a restart, and the zoom. */
function StatusBar({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  const { state } = updater;
  const { zoom, zoomIn, zoomOut, reset } = useZoom();
  return (
    <footer className="status-bar">
      <div className="status-update" role="status">
        {(state.kind === "available" || state.kind === "installing") && (
          <span className="update-note">
            {state.kind === "available" ? t("update.available", { version: state.version }) : t("update.installing")}
            {state.kind === "available" && (
              <button className="btn small primary" onClick={() => void updater.installNow()}>
                {t("update.install")}
              </button>
            )}
          </span>
        )}
      </div>
      <div className="zoom" role="group" aria-label={t("zoom.label")}>
        <button className="zoom-button" title={t("zoom.out")} aria-label={t("zoom.out")} onClick={zoomOut}>
          −
        </button>
        <button className="zoom-level" title={t("zoom.reset")} onClick={reset}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="zoom-button" title={t("zoom.in")} aria-label={t("zoom.in")} onClick={zoomIn}>
          +
        </button>
      </div>
    </footer>
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
        <div className="app-frame">
          <div className="shell">
            <nav className="sidebar">
              {(["overview", "budget", "types", "investments", "income", "insurance", "accounts", "settings"] as const).map((id) => (
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
              <div className="page">
                {page === "overview" && <OverviewPage onNavigate={setPage} />}
                {page === "budget" && <BudgetPage />}
                {page === "types" && <AccountTypesPage />}
                {page === "investments" && <InvestmentsPage />}
                {page === "income" && <FeesIncomePage onNavigate={setPage} />}
                {page === "insurance" && <InsurancePage />}
                {page === "accounts" && <Accounts />}
                {page === "settings" && <Settings status={status} onStatus={onStatus} updater={updater} />}
              </div>
            </main>
          </div>
          <StatusBar updater={updater} />
        </div>
      </JobsProvider>
    </DataProvider>
  );
}
