// The holdings of the account selected on the overview, beside the chart and table.
import { accountInsurer, amount } from "@kerfin/core";
import type { Account, Holding } from "@kerfin/core";
import { useEffect, useState } from "react";

import { useData } from "../data";
import { engine } from "../engine";
import { kindLabel, money, percent, t } from "../i18n";

export function HoldingsPanel({ account, onClose }: { account: Account; onClose: () => void }) {
  const { accountInstitution } = useData();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);

  useEffect(() => {
    setHoldings(null);
    engine.accountDetail(account.id).then(
      (detail) => setHoldings(detail.holdings),
      () => setHoldings([]),
    );
  }, [account.id]);

  const total = (holdings ?? []).reduce((sum, h) => sum + Math.max(amount(h.valuation), 0), 0);
  const insurer = accountInsurer(account);

  return (
    <aside className="card holdings-panel" aria-label={t("panel.title", { name: account.label })}>
      <div className="card-header" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h2 className="ellipsis">{account.label}</h2>
          <div className="muted small">
            {[accountInstitution(account), kindLabel(account.kind), insurer].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button className="btn small ghost" aria-label={t("panel.close")} onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-value num">
        {account.balance == null ? "–" : money(amount(account.balance), account.currency ?? "EUR")}
      </div>
      {holdings === null ? (
        <div className="spinner" />
      ) : holdings.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          {t("panel.none")}
        </p>
      ) : (
        <table className="table holdings-table">
          <thead>
            <tr>
              <th>{t("panel.holding")}</th>
              <th className="right">{t("portfolio.value")}</th>
              <th className="right">{t("portfolio.share")}</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => (
              <tr key={`${h.isin ?? h.label}-${i}`}>
                <td>
                  <div className="holding-name">{h.label === "?" ? t("panel.unnamed") : h.label}</div>
                  {h.isin && <div className="muted small">{h.isin}</div>}
                </td>
                <td className="right num">{h.valuation ? money(amount(h.valuation), h.currency ?? "EUR") : "–"}</td>
                <td className="right num">{total ? percent(Math.max(amount(h.valuation), 0) / total) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </aside>
  );
}
