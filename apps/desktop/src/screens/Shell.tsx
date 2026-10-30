import type { EngineStatus } from "@kerfin/core";
import { useState } from "react";

import { JobsProvider } from "../components/Jobs";
import { RefreshOnStart } from "../components/RefreshOnStart";
import { DataProvider } from "../data";
import { engine } from "../engine";
import { t } from "../i18n";
import type { useUpdater } from "../updater";
import { Accounts } from "./Accounts";
import { AccountTypesPage } from "./AccountTypes";
import { BudgetPage } from "./Budget";
import { BudgetAnalysisPage } from "./BudgetAnalysis";
import { FeesIncomePage } from "./FeesIncome";
import { InsurancePage } from "./Insurance";
import { InvestmentsPage } from "./Investments";
import { OverviewPage } from "./Overview";
import { Settings } from "./Settings";

type Page = "overview" | "budget" | "analysis" | "types" | "investments" | "income" | "insurance" | "accounts" | "settings";

/** The window's top row, above the navigation and every page, while an update waits for a restart. */
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
        <div className="app-frame">
          <UpdateBar updater={updater} />
          <div className="shell">
            <nav className="sidebar">
              {(["overview", "budget", "analysis", "types", "investments", "income", "insurance", "accounts", "settings"] as const).map((id) => (
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
                {page === "analysis" && <BudgetAnalysisPage />}
                {page === "types" && <AccountTypesPage />}
                {page === "investments" && <InvestmentsPage />}
                {page === "income" && <FeesIncomePage onNavigate={setPage} />}
                {page === "insurance" && <InsurancePage />}
                {page === "accounts" && <Accounts />}
                {page === "settings" && <Settings status={status} onStatus={onStatus} updater={updater} />}
              </div>
            </main>
          </div>
        </div>
      </JobsProvider>
    </DataProvider>
  );
}
