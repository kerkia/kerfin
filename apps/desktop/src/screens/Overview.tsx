import { allocationByInstitution, allocationByKind, changeOver, netWorth, netWorthHistory } from "@kerfin/core";
import type { AccountKind } from "@kerfin/core";
import { useMemo, useState } from "react";

import { AddAccount } from "../components/AddAccount";
import { BarList, LineChart } from "../components/charts";
import { useMinuteTick } from "../components/Jobs";
import { useData } from "../data";
import { ago, errorText, kindLabel, money, percent, signedMoney, t } from "../i18n";

export function OverviewPage({ onNavigate }: { onNavigate: (page: "accounts") => void }) {
  const { overview, accountInstitution, institutionName } = useData();
  const [adding, setAdding] = useState(false);
  useMinuteTick();

  const figures = useMemo(() => {
    if (!overview) return null;
    const history = netWorthHistory(overview.history, overview.accounts);
    return {
      worth: netWorth(overview.accounts),
      history,
      change: changeOver(history, 30),
      byKind: allocationByKind(overview.accounts),
      byInstitution: allocationByInstitution(overview.accounts, accountInstitution),
      lastUpdate: overview.accounts.map((a) => a.updated_at).sort().pop(),
    };
  }, [overview, accountInstitution]);

  if (!overview || !figures) return null;

  const failing = overview.connections.filter((c) => c.last_status && c.last_status !== "ok");

  if (overview.accounts.length === 0) {
    return (
      <>
        <h1>{t("overview.title")}</h1>
        <div className="card empty">
          <h2>{t("overview.emptyTitle")}</h2>
          <p className="secondary" style={{ margin: 0 }}>
            {t("overview.emptyBody")}
          </p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            {t("accounts.add")}
          </button>
        </div>
        <AddAccount open={adding} onClose={() => setAdding(false)} />
      </>
    );
  }

  const { worth, change } = figures;
  return (
    <>
      <h1>{t("overview.title")}</h1>

      <section className="card">
        <div className="hero-label">{t("overview.netWorth")}</div>
        <div className="hero-value">{money(worth.total, "EUR", { maximumFractionDigits: 0 })}</div>
        <div className="row secondary" style={{ flexWrap: "wrap" }}>
          {change && (
            <span className={change.absolute >= 0 ? "delta-up" : "delta-down"}>
              {change.absolute >= 0 ? "▲" : "▼"} {signedMoney(change.absolute)} ({percent(change.relative, true)}){" "}
              <span className="secondary">{t("overview.over30Days")}</span>
            </span>
          )}
          <span>
            {t("overview.assets", {
              assets: money(worth.assets, "EUR", { maximumFractionDigits: 0 }),
              debts: money(worth.liabilities, "EUR", { maximumFractionDigits: 0 }),
            })}
          </span>
          {figures.lastUpdate && <span className="muted">· {ago(figures.lastUpdate)}</span>}
        </div>
        {worth.otherCurrencies.length > 0 && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            {t("overview.otherCurrencies", {
              list: worth.otherCurrencies.map((o) => money(o.total, o.currency)).join(", "),
            })}
          </p>
        )}
      </section>

      {failing.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>{t("overview.attention")}</h2>
            <button className="btn small" onClick={() => onNavigate("accounts")}>
              {t("nav.accounts")}
            </button>
          </div>
          {failing.map((c) => (
            <div key={c.id} className="row" style={{ padding: "4px 0" }}>
              <span className="status error" />
              <strong>{c.label || institutionName(c.institution)}</strong>
              <span className="secondary">{errorText(c.last_status)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>{t("overview.history")}</h2>
        </div>
        {figures.history.length >= 2 ? (
          <LineChart series={figures.history} />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {t("overview.historyEmpty")}
          </p>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>{t("overview.byKind")}</h2>
          </div>
          <BarList slices={figures.byKind} label={(key) => kindLabel(key as AccountKind)} />
        </section>
        <section className="card">
          <div className="card-header">
            <h2>{t("overview.byInstitution")}</h2>
          </div>
          <BarList slices={figures.byInstitution} label={(key) => key} />
        </section>
      </div>
    </>
  );
}
