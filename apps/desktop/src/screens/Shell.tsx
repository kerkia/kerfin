import type { EngineStatus } from "@kerfin/core";
import { useState } from "react";

import { JobsProvider } from "../components/Jobs";
import { RefreshOnStart } from "../components/RefreshOnStart";
import { DataProvider } from "../data";
import { engine } from "../engine";
import { t } from "../i18n";
import type { useUpdater } from "../updater";
import { Accounts } from "./Accounts";
import { OverviewPage } from "./Overview";
import { Settings } from "./Settings";

type Page = "overview" | "accounts" | "settings";

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
            {(["overview", "accounts", "settings"] as const).map((id) => (
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
              {updater.state.kind === "available" && (
                <div className="banner">
                  <span>{t("update.available", { version: updater.state.version })}</span>
                  <button className="btn small" onClick={() => void updater.installNow()}>
                    {t("update.install")}
                  </button>
                </div>
              )}
              {page === "overview" && <OverviewPage onNavigate={setPage} />}
              {page === "accounts" && <Accounts />}
              {page === "settings" && <Settings status={status} onStatus={onStatus} updater={updater} />}
            </div>
          </main>
        </div>
      </JobsProvider>
    </DataProvider>
  );
}
