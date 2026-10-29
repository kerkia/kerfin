// What the investments cost and pay each year: funds' charges and contract fees, with what
// they add up to over time; and the passive income (distributions, stated interest) of
// today's holdings over the next twelve months.
import { INSURED_KINDS, feeCost, feeSummary, incomeCalendar, incomeLines } from "@kerfin/core";
import type { Account, ContractRate, Market } from "@kerfin/core";
import { useEffect, useMemo, useState } from "react";

import { ColumnChart } from "../components/charts";
import { useData } from "../data";
import { engine } from "../engine";
import { money, monthName, rate, t } from "../i18n";
import { MatchTag } from "./Investments";

const HORIZONS = [10, 20, 30] as const;
const GROWTH_CHOICES = [0.03, 0.05, 0.07] as const;

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function storedGrowth(): number {
  try {
    const value = Number(localStorage.getItem("kerfin.feeGrowth"));
    return (GROWTH_CHOICES as readonly number[]).includes(value) ? value : 0.05;
  } catch {
    return 0.05;
  }
}

const whole = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 });

export function FeesIncomePage({ onNavigate }: { onNavigate: (page: "accounts") => void }) {
  const { overview } = useData();
  const [market, setMarket] = useState<Market | null>(null);
  const [growth, setGrowth] = useState(storedGrowth);

  // Reload after each sync: the overview changes then.
  useEffect(() => {
    engine.market().then(setMarket, () => undefined);
  }, [overview]);

  const figures = useMemo(() => {
    if (!market || !overview) return null;
    const today = localToday();
    const visible = new Set(overview.accounts.filter((a) => !a.hidden).map((a) => a.id));
    const scoped = { ...market, holdings: market.holdings.filter((h) => visible.has(h.account_id)) };
    const fees = feeSummary(scoped, overview.accounts);
    const income = incomeLines(scoped, today);
    return { fees, income, calendar: incomeCalendar(income, today) };
  }, [market, overview]);

  if (!overview || !figures) return <h1>{t("nav.income")}</h1>;
  const { fees, income, calendar } = figures;
  const accounts = new Map(overview.accounts.map((a): [string, Account] => [a.id, a]));
  const yearlyFees = fees.fundFees + fees.contractFees;
  const feeRate = yearlyFees / (fees.value || 1);
  const expected = income.reduce((sum, line) => sum + line.yearly, 0);
  const paying = income.filter((line) => line.source !== "reinvested");
  const reinvested = income.filter((line) => line.source === "reinvested");
  const stated = income.filter((line) => line.source === "stated").reduce((sum, line) => sum + line.yearly, 0);

  if (fees.value === 0) {
    return (
      <>
        <h1>{t("nav.income")}</h1>
        <div className="card empty">
          <p className="secondary" style={{ margin: 0 }}>
            {t("inv.empty")}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>{t("nav.income")}</h1>

      <div className="kpi-row">
        <Kpi label={t("fees.yearly")} value={whole(yearlyFees)} detail={t("fees.ofValue", { rate: rate(feeRate), value: whole(fees.value) })} />
        <Kpi label={t("income.expected")} value={whole(expected)} detail={t("fees.ofValue", { rate: rate(expected / (fees.value || 1)), value: whole(fees.value) })} />
        <Kpi label={t("income.net")} value={money(expected - yearlyFees, "EUR", { maximumFractionDigits: 0, signDisplay: "exceptZero" })} detail={t("income.netHelp")} />
      </div>

      {(fees.contractsUnknown.length > 0 || fees.fundUnknown > 0) && (
        <div className="banner">
          <div>
            {fees.contractsUnknown.length > 0 && (
              <p style={{ margin: 0 }}>
                {t("fees.contractsUnknown", { names: fees.contractsUnknown.map((a) => a.label).join(", ") })}
              </p>
            )}
            {fees.fundUnknown > 0 && (
              <p className="small" style={{ margin: fees.contractsUnknown.length ? "4px 0 0" : 0 }}>
                {t("fees.fundUnknown", { value: whole(fees.fundUnknown) })}
              </p>
            )}
          </div>
          {fees.contractsUnknown.length > 0 && (
            <button className="btn small" onClick={() => onNavigate("accounts")}>
              {t("fees.setInAccounts")}
            </button>
          )}
        </div>
      )}

      <h1 className="section-title">{t("fees.title")}</h1>
      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>{t("fees.byAccount")}</h2>
          </div>
          <div className="table-scroll">
            <table className="table portfolio">
              <thead>
                <tr>
                  <th>{t("fees.account")}</th>
                  <th className="right">{t("portfolio.value")}</th>
                  <th className="right">{t("fees.funds")}</th>
                  <th className="right">{t("fees.contract")}</th>
                  <th className="right">{t("fees.perYear")}</th>
                </tr>
              </thead>
              <tbody>
                {fees.accounts.map((row) => (
                  <tr key={row.account.id}>
                    <td>{row.account.label}</td>
                    <td className="right num">{whole(row.value)}</td>
                    <td className="right num">{row.value - row.fundUnknown > 0 ? rate(row.fundFees / (row.value - row.fundUnknown)) : "—"}</td>
                    <td className="right num">
                      <ContractCell contract={row.contract} insured={row.contract !== null || fees.contractsUnknown.includes(row.account)} />
                    </td>
                    <td className="right num">{whole(row.fundFees + row.contractFees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t("fees.overTime")}</h2>
            <select
              className="input compact"
              aria-label={t("fees.growth")}
              value={growth}
              onChange={(e) => {
                const value = Number(e.target.value);
                setGrowth(value);
                try {
                  localStorage.setItem("kerfin.feeGrowth", String(value));
                } catch {
                  // a convenience only
                }
              }}
            >
              {GROWTH_CHOICES.map((g) => (
                <option key={g} value={g}>
                  {t("fees.growthOption", { rate: rate(g) })}
                </option>
              ))}
            </select>
          </div>
          <div className="kpi-row compact">
            {HORIZONS.map((years) => (
              <div key={years}>
                <div className="hero-label">{t("fees.years", { n: years })}</div>
                <div className="kpi-value num">{whole(feeCost(fees.value, feeRate, growth, years))}</div>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {t("fees.overTimeHelp", { rate: rate(feeRate), growth: rate(growth) })}
          </p>
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>{t("fees.byHolding")}</h2>
        </div>
        <div className="table-scroll">
          <table className="table portfolio">
            <thead>
              <tr>
                <th>{t("inv.fund")}</th>
                <th className="right">{t("portfolio.value")}</th>
                <th className="right">{t("fees.funds")}</th>
                <th className="right">{t("fees.contract")}</th>
                <th className="right">{t("fees.perYear")}</th>
              </tr>
            </thead>
            <tbody>
              {fees.lines.map((line, i) => (
                <tr key={`${line.holding.account_id}-${line.holding.isin ?? line.holding.label}-${i}`}>
                  <td>
                    <div>
                      {line.holding.label} <MatchTag match={line.holding.match} />
                    </div>
                    <div className="muted small">{[line.holding.isin, line.account?.label].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="right num">{whole(line.value)}</td>
                  <td className="right num">{line.fundRate === null ? <span className="muted">{t("fees.unknown")}</span> : rate(line.fundRate)}</td>
                  <td className="right num">
                    <ContractCell contract={line.contract} insured={!!line.account && INSURED_KINDS.has(line.account.kind)} />
                  </td>
                  <td className="right num">{whole(line.yearly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ margin: "10px 0 0" }}>
          {t("fees.sources")}
        </p>
      </section>

      <h1 className="section-title">{t("income.title")}</h1>
      <section className="card">
        <div className="card-header">
          <h2>{t("income.byMonth")}</h2>
        </div>
        {calendar.some((m) => m.value > 0) ? (
          <ColumnChart
            columns={calendar.map((m) => ({ key: m.month, value: m.value }))}
            label={(month) => monthName(month)}
            title={(month) => monthName(month, true)}
          />
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            {t("income.noDistributions")}
          </p>
        )}
        <p className="muted small" style={{ margin: "10px 0 0" }}>
          {t("income.byMonthHelp")}
          {stated > 0 && <> {t("income.statedApart", { value: whole(stated) })}</>}
        </p>
      </section>
      <section className="card">
        <div className="card-header">
          <h2>{t("income.byHolding")}</h2>
        </div>
        {paying.length ? (
          <div className="table-scroll">
            <table className="table portfolio">
              <thead>
                <tr>
                  <th>{t("inv.fund")}</th>
                  <th>{t("income.source")}</th>
                  <th className="right">{t("portfolio.value")}</th>
                  <th className="right">{t("income.payments")}</th>
                  <th className="right">{t("income.yield")}</th>
                  <th className="right">{t("income.perYear")}</th>
                </tr>
              </thead>
              <tbody>
                {paying.map((line, i) => (
                  <tr key={`${line.holding.account_id}-${line.holding.isin ?? line.holding.label}-${i}`}>
                    <td>
                      <div>{line.holding.label}</div>
                      <div className="muted small">
                        {[line.holding.isin, accounts.get(line.holding.account_id)?.label].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>
                      <span className="tag">{t(`income.source.${line.source}`)}</span>
                    </td>
                    <td className="right num">{whole(line.value)}</td>
                    <td className="right num">{line.source === "distributions" ? line.payments.length : "—"}</td>
                    <td className="right num">{rate(line.yield)}</td>
                    <td className="right num">{money(line.yearly, "EUR", { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            {t("income.none")}
          </p>
        )}
        {reinvested.length > 0 && (
          <p className="small secondary" style={{ margin: "10px 0 0" }}>
            {t("income.reinvestedHelp", { n: reinvested.length, value: whole(reinvested.reduce((sum, line) => sum + line.value, 0)) })}
          </p>
        )}
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          {t("income.sources")}
        </p>
      </section>
    </>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="card kpi">
      <div className="hero-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      <div className="muted small">{detail}</div>
    </section>
  );
}

/** A contract's fee rate, marked when it is the published one rather than the user's. */
function ContractCell({ contract, insured }: { contract: ContractRate | null; insured: boolean }) {
  if (!contract) return insured ? <span className="muted">{t("fees.notSet")}</span> : <span className="muted">—</span>;
  return (
    <span title={contract.source === "suggested" ? t("fees.suggestedHelp") : t("fees.userHelp")}>
      {rate(contract.rate)}
      {contract.source === "suggested" && <span className="muted"> *</span>}
    </span>
  );
}

