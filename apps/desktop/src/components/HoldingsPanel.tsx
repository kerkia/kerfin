// The holdings of the account selected on the overview, beside the chart and table. When
// Kerfin had to guess which value belongs to which fund, it lists them in the source's
// order, numbered, so the pairing can be checked against Finary.
import { accountInsurer, amount } from "@kerfin/core";
import type { Account, Holding } from "@kerfin/core";
import { useEffect, useState } from "react";

import { useData } from "../data";
import { engine } from "../engine";
import { kindLabel, money, percent, t } from "../i18n";
import { MatchTag } from "../screens/Investments";

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

  const list = holdings ?? [];
  const total = list.reduce((sum, h) => sum + Math.max(amount(h.valuation), 0), 0);
  const insurer = accountInsurer(account);
  const guessed = list.some((h) => h.match === "order" || h.match === "order_uncertain");
  const uncertain = list.some((h) => h.match === "order_uncertain" || h.match === "unpaired");
  const values = list.filter((h) => h.match !== "unpaired").length;
  const funds = list.filter((h) => h.isin || h.match === "unpaired").length;
  // A guessed pairing is shown in the source's order; otherwise largest first.
  const shown = guessed ? list : [...list].sort((a, b) => amount(b.valuation) - amount(a.valuation));

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
      {guessed && (
        <p className={uncertain ? "panel-note uncertain small" : "panel-note small"}>
          {uncertain ? t("panel.uncertain", { values, funds }) : t("panel.guessed")}
        </p>
      )}
      {holdings === null ? (
        <div className="spinner" />
      ) : list.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          {t("panel.none")}
        </p>
      ) : (
        <table className="table holdings-table">
          <thead>
            <tr>
              {guessed && <th className="right">#</th>}
              <th>{guessed ? t("panel.fund") : t("panel.holding")}</th>
              <th className="right">{t("portfolio.value")}</th>
              <th className="right">{t("portfolio.share")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((h, i) => (
              <tr key={`${h.isin ?? h.label}-${i}`}>
                {guessed && <td className="right muted num">{i + 1}</td>}
                <td>
                  <div className="holding-name">
                    {h.label === "?" ? t("panel.unnamed") : h.label} <MatchTag match={h.match} />
                  </div>
                  {h.isin && <div className="muted small">{h.isin}</div>}
                </td>
                <td className="right num">{h.valuation ? money(amount(h.valuation), h.currency ?? "EUR") : "—"}</td>
                <td className="right num">{total && h.valuation ? percent(Math.max(amount(h.valuation), 0) / total) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </aside>
  );
}
