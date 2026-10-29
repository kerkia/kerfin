// What the investments cost and pay each year: funds' charges (security fees) and life
// insurance and PER contracts' fees (account fees), with what they add up to over time; and
// the passive income (distributions, stated interest) of today's holdings over the next year.
import { INSURED_KINDS, contractRate, feeCost, feeSummary, incomeCalendar, incomeLines } from "@kerfin/core";
import type { AccountFees, ContractRate, IncomeLine, Market, MarketHolding } from "@kerfin/core";
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
  const [accountId, setAccountId] = useState("");

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
    return { today, fees, income, incomeOf: new Map(income.map((line): [MarketHolding, IncomeLine] => [line.holding, line])) };
  }, [market, overview]);

  if (!overview || !figures) return <h1>{t("nav.income")}</h1>;
  const { today, fees, incomeOf } = figures;

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

  // Everything but the account fees table follows the account picked (all of them when it is
  // gone since).
  const selected = fees.accounts.find((a) => a.account.id === accountId);
  const shown = selected?.account.id ?? "";
  const scope = selected
    ? {
        value: selected.value,
        fundFees: selected.fundFees,
        contractFees: selected.contractFees,
        insured: INSURED_KINDS.has(selected.account.kind) ? selected.value : 0,
        fundUnknown: selected.fundUnknown,
        contractsUnknown: fees.contractsUnknown.filter((a) => a.id === shown),
      }
    : fees;
  const income = figures.income.filter((line) => !shown || line.holding.account_id === shown);
  const calendar = incomeCalendar(income, today);
  const yearlyFees = scope.fundFees + scope.contractFees;
  const feeRate = yearlyFees / (scope.value || 1);
  const expected = income.reduce((sum, line) => sum + line.yearly, 0);
  const reinvested = income.filter((line) => line.source === "reinvested");
  const stated = income.filter((line) => line.source === "stated").reduce((sum, line) => sum + line.yearly, 0);

  // Holdings, largest first.
  const rows = fees.lines.filter((line) => !shown || line.holding.account_id === shown).sort((a, b) => b.value - a.value);
  const rowTotal = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const security = (row: (typeof rows)[number]) => row.value * (row.fundRate ?? 0);
  // Funds' maximum entry fees: a column only when some fund has one.
  const entryFee = (row: (typeof rows)[number]) => (row.holding.entry_fees ? Number(row.holding.entry_fees) : 0);
  const withEntryFees = fees.lines.some((line) => entryFee(line) > 0);
  // Contracts first, by their fees; then the accounts without account fees.
  const accountRows = [...fees.accounts].sort((a, b) => b.contractFees - a.contractFees || b.value - a.value);

  return (
    <>
      <div className="page-header">
        <h1>{t("nav.income")}</h1>
        <select className="input compact" aria-label={t("fees.filter")} value={shown} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{t("fees.allAccounts")}</option>
          {fees.accounts.map((a) => (
            <option key={a.account.id} value={a.account.id}>
              {a.account.label}
            </option>
          ))}
        </select>
      </div>

      <div className="kpi-row">
        <Kpi
          label={t("fees.security")}
          value={whole(scope.fundFees)}
          detail={t("fees.ofValue", { rate: rate(scope.fundFees / (scope.value || 1)), value: whole(scope.value) })}
        />
        <Kpi
          label={t("fees.account")}
          value={whole(scope.contractFees)}
          detail={scope.insured > 0 ? t("fees.ofInsured", { rate: rate(scope.contractFees / scope.insured), value: whole(scope.insured) }) : t("fees.noInsured")}
        />
        <Kpi label={t("income.expected")} value={whole(expected)} detail={t("fees.ofValue", { rate: rate(expected / (scope.value || 1)), value: whole(scope.value) })} />
        <Kpi label={t("income.net")} value={money(expected - yearlyFees, "EUR", { maximumFractionDigits: 0, signDisplay: "exceptZero" })} detail={t("income.netHelp")} />
      </div>

      {(scope.contractsUnknown.length > 0 || scope.fundUnknown > 0) && (
        <div className="banner">
          <div>
            {scope.contractsUnknown.length > 0 && (
              <p style={{ margin: 0 }}>
                {t("fees.contractsUnknown", { names: scope.contractsUnknown.map((a) => a.label).join(", ") })}
              </p>
            )}
            {scope.fundUnknown > 0 && (
              <p className="small" style={{ margin: scope.contractsUnknown.length ? "4px 0 0" : 0 }}>
                {t("fees.fundUnknown", { value: whole(scope.fundUnknown) })}
              </p>
            )}
          </div>
          {scope.contractsUnknown.length > 0 && (
            <button className="btn small" onClick={() => onNavigate("accounts")}>
              {t("fees.setInAccounts")}
            </button>
          )}
        </div>
      )}

      <div className="grid-2">
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
                <div className="kpi-value num">{whole(feeCost(scope.value, feeRate, growth, years))}</div>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {t("fees.overTimeHelp", { rate: rate(feeRate), growth: rate(growth) })}
          </p>
        </section>

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
      </div>

      <div className="split-tables">
        <section className="card">
          <div className="card-header">
            <h2>{selected ? t("fees.holdingsOf", { account: selected.account.label }) : t("fees.holdings")}</h2>
          </div>
          <div className="table-scroll">
            <table className="table portfolio">
              <thead>
                <tr>
                  <th>{t("fees.holding")}</th>
                  <th className="right">{t("portfolio.value")}</th>
                  <th className="right">{t("fees.rate")}</th>
                  <th className="right">{t("fees.perYear")}</th>
                  {withEntryFees && <th className="right">{t("fees.entry")}</th>}
                  <th className="right">{t("income.yield")}</th>
                  <th className="right">{t("income.perYear")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const paid = incomeOf.get(row.holding);
                  return (
                    <tr key={`${row.holding.account_id}-${row.holding.isin ?? row.holding.label}-${i}`}>
                      <td className="holding-name">
                        <div>
                          {row.holding.label} <MatchTag match={row.holding.match} />
                        </div>
                        <div className="muted small">{[row.holding.isin, shown ? null : row.account?.label].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="right num">{whole(row.value)}</td>
                      <td className="right num">
                        {row.euroFund ? (
                          <span className="muted">{t("fees.inContract")}</span>
                        ) : row.fundRate === null ? (
                          <span className="muted">{t("fees.unknown")}</span>
                        ) : (
                          rate(row.fundRate)
                        )}
                      </td>
                      <td className="right num">{whole(security(row))}</td>
                      {withEntryFees && (
                        <td className="right num">{entryFee(row) > 0 ? rate(entryFee(row)) : <span className="muted">—</span>}</td>
                      )}
                      <td className="right num">
                        {paid ? (
                          <>
                            <div>{paid.source === "reinvested" ? <span className="muted">—</span> : rate(paid.yield)}</div>
                            <div className="muted small">{t(`income.source.${paid.source}`, { n: paid.payments.length })}</div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="right num">{paid && paid.yearly > 0 ? whole(paid.yearly) : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={withEntryFees ? 7 : 6} className="muted">
                      {t("fees.noHoldings")}
                    </td>
                  </tr>
                )}
                <tr className="total-row">
                  <td>{t("fees.total")}</td>
                  <td className="right num">{whole(rowTotal((row) => row.value))}</td>
                  <td />
                  <td className="right num">{whole(rowTotal(security))}</td>
                  {withEntryFees && <td />}
                  <td />
                  <td className="right num">{whole(rowTotal((row) => incomeOf.get(row.holding)?.yearly ?? 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {reinvested.length > 0 && (
            <p className="small secondary" style={{ margin: "10px 0 0" }}>
              {t("income.reinvestedHelp", { n: reinvested.length, value: whole(reinvested.reduce((sum, line) => sum + line.value, 0)) })}
            </p>
          )}
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            {t("fees.sources")} {withEntryFees && t("fees.entryHelp")} {t("income.sources")}
          </p>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t("fees.accounts")}</h2>
          </div>
          <div className="table-scroll">
            <table className="table portfolio">
              <thead>
                <tr>
                  <th>{t("fees.accountCol")}</th>
                  <th className="right">{t("portfolio.value")}</th>
                  <th className="right">{t("fees.contractRate")}</th>
                  <th className="right">{t("fees.perYear")}</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((row) => (
                  <tr
                    key={row.account.id}
                    className={row.account.id === shown ? "clickable selected" : "clickable"}
                    onClick={() => setAccountId(row.account.id === shown ? "" : row.account.id)}
                  >
                    <td>{row.account.label}</td>
                    <td className="right num">{whole(row.value)}</td>
                    <td className="right num">
                      <AccountRate row={row} insured={row.contract !== null || fees.contractsUnknown.includes(row.account)} />
                    </td>
                    <td className="right num">{row.contractFees > 0 ? whole(row.contractFees) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                <tr className={shown ? "total-row clickable" : "total-row clickable selected"} onClick={() => setAccountId("")}>
                  <td>{t("fees.total")}</td>
                  <td className="right num">{whole(fees.value)}</td>
                  <td />
                  <td className="right num">{whole(fees.contractFees)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {t("fees.accountsHelp")}
          </p>
        </section>
      </div>
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

/** A contract's fee rate on its funds, with its euro fund's when that differs. */
function AccountRate({ row, insured }: { row: AccountFees; insured: boolean }) {
  const euro = row.euroFund > 0 && INSURED_KINDS.has(row.account.kind) ? contractRate(row.account, true) : undefined;
  return (
    <>
      <div>
        <ContractCell contract={row.contract} insured={insured} />
      </div>
      {euro !== undefined && euro?.rate !== row.contract?.rate && (
        <div className="muted small">{t("fees.euroFund", { rate: euro ? rate(euro.rate) : t("fees.unknown") })}</div>
      )}
    </>
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
