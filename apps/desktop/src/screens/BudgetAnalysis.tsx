// Budget analysis: spending a month over the period, for the current accounts and cards and
// the spending categories picked, as a total or split by category or by account; each line's
// average, spread and trend, and where the trend leads over the months to come.
import { DEFAULT_CATEGORIES, addMonths, projection, spendingAnalysis, trendAt, trendStats, withRequired } from "@kerfin/core";
import type { AccountTransaction, CategoryDef, SplitBy, TrendStats } from "@kerfin/core";
import { useEffect, useMemo, useState } from "react";

import { PRESETS, PeriodPicker, localToday, rangeOf, remember, stored } from "../components/Period";
import type { Preset } from "../components/Period";
import { TrendChart } from "../components/charts";
import type { TrendSeries } from "../components/charts";
import { useData } from "../data";
import { engine } from "../engine";
import { categoryName, money, monthName, percent, t } from "../i18n";

const SPLITS = ["total", "category", "account"] as const;
const AHEAD = ["3", "6", "12"] as const;
const DAY_TO_DAY = new Set(["checking", "card"]);
const COLORS = 6; // named series; the rest fold into "Other"
const OTHER = "__other";
const MIN_MONTHS = 3; // for a trend worth showing

const whole = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 });
// A trend's monthly change: in cents while small, for a slow trend not to read as none.
const change = (value: number) =>
  money(value, "EUR", { signDisplay: "exceptZero", maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0 });

export function BudgetAnalysisPage() {
  const { overview } = useData();
  const [transactions, setTransactions] = useState<AccountTransaction[] | null>(null);
  const [rules, setRules] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<CategoryDef[]>(DEFAULT_CATEGORIES);
  const [offAccounts, setOffAccounts] = useState<Set<string>>(new Set());
  const [offCategories, setOffCategories] = useState<Set<string>>(new Set());
  const today = localToday();
  const [preset, setPreset] = useState<Preset>(() => stored("kerfin.analysisRange", PRESETS, "12"));
  const [custom, setCustom] = useState(() => rangeOf("12", today, { from: today, to: today }));
  const [split, setSplit] = useState<SplitBy>(() => stored("kerfin.analysisSplit", SPLITS, "total"));
  const [ahead, setAhead] = useState(() => stored("kerfin.analysisAhead", AHEAD, "6"));

  // Reload after each sync or import: the overview changes then.
  useEffect(() => {
    engine.transactions().then(
      (answer) => {
        setTransactions(answer.transactions);
        setRules(answer.rules);
        setCategories(withRequired(answer.categories ?? DEFAULT_CATEGORIES));
      },
      () => undefined,
    );
  }, [overview]);

  // Current accounts and cards with transactions, the hidden ones aside.
  const accounts = useMemo(() => {
    if (!overview || !transactions) return [];
    const listed = new Set(transactions.map((tx) => tx.account_id));
    return overview.accounts.filter((a) => !a.hidden && DAY_TO_DAY.has(a.kind) && listed.has(a.id));
  }, [overview, transactions]);
  const spending = categories.filter((c) => c.kind === "spending");
  const range = rangeOf(preset, today, custom);

  const analysis = useMemo(() => {
    if (!transactions || range.from > range.to) return null;
    return spendingAnalysis(transactions, {
      accounts: new Set(accounts.map((a) => a.id).filter((id) => !offAccounts.has(id))),
      picked: new Set(spending.map((c) => c.key).filter((key) => !offCategories.has(key))),
      range,
      today,
      split,
      rules,
      categories,
    });
    // The range by its dates: rangeOf gives a new object each render.
  }, [transactions, accounts, offAccounts, offCategories, range.from, range.to, today, split, rules, categories]);

  const header = (
    <div className="page-header">
      <h1>{t("nav.analysis")}</h1>
      <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
        <PeriodPicker
          preset={preset}
          custom={custom}
          range={range}
          storageKey="kerfin.analysisRange"
          onPreset={setPreset}
          onCustom={setCustom}
        />
        <select
          className="input compact"
          aria-label={t("analysis.ahead")}
          value={ahead}
          onChange={(e) => {
            setAhead(e.target.value as (typeof AHEAD)[number]);
            remember("kerfin.analysisAhead", e.target.value);
          }}
        >
          {AHEAD.map((n) => (
            <option key={n} value={n}>
              {t("analysis.aheadMonths", { n })}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  if (!overview || !transactions) return <h1>{t("nav.analysis")}</h1>;
  if (accounts.length === 0) {
    return (
      <>
        {header}
        <div className="card empty">
          <p className="secondary" style={{ margin: 0 }}>
            {t("analysis.empty")}
          </p>
        </div>
      </>
    );
  }

  const byKey = new Map(categories.map((c) => [c.key, c]));
  const accountNames = new Map(accounts.map((a) => [a.id, a.label]));
  const nameOf = (key: string) =>
    key === "total"
      ? t("analysis.total")
      : key === OTHER
        ? t("analysis.other")
        : split === "account"
          ? (accountNames.get(key) ?? key)
          : categoryName(byKey.get(key) ?? { key });

  const months = analysis?.months ?? [];
  // The largest lines are named, in the list's order so a line keeps its color as others
  // come and go; the rest are added up as "Other".
  const order = split === "account" ? accounts.map((a) => a.id) : spending.map((c) => c.key);
  const ranked = analysis?.series ?? [];
  const named = new Set(ranked.slice(0, ranked.length > COLORS ? COLORS - 1 : COLORS).map((s) => s.key));
  const lines =
    split === "total"
      ? ranked
      : order.flatMap((key) => (named.has(key) ? ranked.filter((s) => s.key === key) : []));
  const rest = ranked.filter((s) => !named.has(s.key));
  if (rest.length) {
    lines.push({ key: OTHER, values: months.map((_, i) => rest.reduce((sum, s) => sum + s.values[i]!, 0)) });
  }
  const chartSeries: TrendSeries[] = lines.map((line, i) => ({
    key: line.key,
    label: nameOf(line.key),
    color: line.key === OTHER ? "var(--series-other)" : `var(--series-${i + 1})`,
    values: line.values,
  }));

  const totalValues = months.map((_, i) => ranked.reduce((sum, s) => sum + s.values[i]!, 0));
  const total = trendStats(totalValues);
  const count = Number(ahead);
  const future = months.length ? Array.from({ length: count }, (_, i) => addMonths(months[months.length - 1]!, i + 1)) : [];
  const enough = months.length >= MIN_MONTHS;
  // The trend and projection are drawn for the total; split, each line's are in the table.
  const trendShown = enough && split === "total";
  const projected = projection(total, count);
  const projectedSum = projected.reduce((sum, v) => sum + v, 0);

  const toggle = (set: (update: (off: Set<string>) => Set<string>) => void, key: string) =>
    set((off) => {
      const next = new Set(off);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      {header}

      <div className="split-tables">
        <section className="card">
          <div className="card-header">
            <h2>{t("analysis.accounts")}</h2>
            <AllNone
              onAll={() => setOffAccounts(new Set())}
              onNone={() => setOffAccounts(new Set(accounts.map((a) => a.id)))}
            />
          </div>
          <div className="check-chips">
            {accounts.map((a) => (
              <label key={a.id} className="check-chip">
                <input type="checkbox" checked={!offAccounts.has(a.id)} onChange={() => toggle(setOffAccounts, a.id)} />
                {a.label}
              </label>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <h2>{t("analysis.categories")}</h2>
            <AllNone
              onAll={() => setOffCategories(new Set())}
              onNone={() => setOffCategories(new Set(spending.map((c) => c.key)))}
            />
          </div>
          <div className="check-chips">
            {spending.map((c) => (
              <label key={c.key} className="check-chip">
                <input type="checkbox" checked={!offCategories.has(c.key)} onChange={() => toggle(setOffCategories, c.key)} />
                {categoryName(c)}
              </label>
            ))}
          </div>
        </section>
      </div>

      {!analysis ? (
        <div className="card empty">
          <p className="secondary" style={{ margin: 0 }}>
            {t("budget.badRange")}
          </p>
        </div>
      ) : months.length === 0 ? (
        <div className="card empty">
          <p className="secondary" style={{ margin: 0 }}>
            {t("analysis.noMonths")}
          </p>
        </div>
      ) : (
        <>
          <div className="kpi-row">
            <Kpi
              label={t("analysis.average")}
              value={whole(total.mean)}
              detail={t("analysis.overMonths", {
                n: months.length,
                from: monthName(months[0]!, true),
                to: monthName(months[months.length - 1]!, true),
              })}
            />
            <Kpi
              label={t("analysis.trend")}
              value={enough ? t("analysis.perMonth", { amount: change(total.slope) }) : "–"}
              detail={
                enough
                  ? t("analysis.trendDetail", { rate: percent(total.yearly, true), r2: total.r2.toFixed(2) })
                  : t("analysis.tooFew", { n: MIN_MONTHS })
              }
            />
            <Kpi
              label={t("analysis.spread")}
              value={whole(total.stdev)}
              detail={t("analysis.spreadDetail", { cv: percent(total.cv), min: whole(total.min), max: whole(total.max) })}
            />
            <Kpi
              label={t("analysis.projected", { n: count })}
              value={enough ? whole(projectedSum) : "–"}
              detail={
                enough
                  ? t("analysis.projectedDetail", {
                      amount: whole(projected[projected.length - 1]!),
                      month: monthName(future[future.length - 1]!, true),
                    })
                  : t("analysis.tooFew", { n: MIN_MONTHS })
              }
            />
          </div>

          <section className="card">
            <div className="card-header">
              <h2>{t("analysis.overTime")}</h2>
              <div className="segmented" role="radiogroup" aria-label={t("analysis.split")}>
                {SPLITS.map((by) => (
                  <button
                    key={by}
                    role="radio"
                    aria-checked={split === by}
                    className={split === by ? "segment active" : "segment"}
                    onClick={() => {
                      setSplit(by);
                      remember("kerfin.analysisSplit", by);
                    }}
                  >
                    {t(`analysis.split.${by}`)}
                  </button>
                ))}
              </div>
            </div>
            {chartSeries.length >= 2 && (
              <div className="trend-legend">
                {chartSeries.map((s) => (
                  <span key={s.key} className="legend-name">
                    <span className="swatch" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                ))}
              </div>
            )}
            {chartSeries.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {t("analysis.nothing")}
              </p>
            ) : (
              <TrendChart
                months={months}
                ahead={trendShown ? future : []}
                series={chartSeries}
                trend={
                  trendShown
                    ? {
                        values: [...months.map((_, i) => trendAt(total, i)), ...projected],
                        band: total.residual,
                        label: t("analysis.trendLine"),
                        projectionLabel: t("analysis.projection"),
                      }
                    : undefined
                }
                label={(m) => monthName(m)}
                title={(m) => monthName(m, true)}
              />
            )}
            <p className="muted small" style={{ margin: "10px 0 0" }}>
              {t(split === "total" ? "analysis.chartHelp" : "analysis.chartHelpSplit")}
            </p>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>{t("analysis.statistics")}</h2>
            </div>
            <div className="table-scroll">
              <table className="table portfolio">
                <thead>
                  <tr>
                    <th>{t(`analysis.split.${split}`)}</th>
                    <th className="right">{t("analysis.col.total")}</th>
                    <th className="right">{t("analysis.col.average")}</th>
                    <th className="right">{t("analysis.col.stdev")}</th>
                    <th className="right">{t("analysis.col.cv")}</th>
                    <th className="right">{t("analysis.col.range")}</th>
                    <th className="right">{t("analysis.col.trend")}</th>
                    <th className="right">{t("analysis.col.yearly")}</th>
                    <th className="right">{t("analysis.col.r2")}</th>
                    <th className="right">{t("analysis.col.projected", { n: count })}</th>
                  </tr>
                </thead>
                <tbody>
                  {(split === "total" ? [] : ranked).map((s) => (
                    <StatsRow key={s.key} name={nameOf(s.key)} stats={trendStats(s.values)} ahead={count} enough={enough} />
                  ))}
                </tbody>
                <tfoot>
                  <StatsRow name={t("analysis.total")} stats={total} ahead={count} enough={enough} />
                </tfoot>
              </table>
            </div>
            <p className="muted small" style={{ margin: "10px 0 0" }}>
              {t("analysis.statsHelp")}
            </p>
          </section>
        </>
      )}
    </>
  );
}

function StatsRow({ name, stats, ahead, enough }: { name: string; stats: TrendStats; ahead: number; enough: boolean }) {
  const dash = <span className="muted">–</span>;
  return (
    <tr>
      <td>{name}</td>
      <td className="right num">{whole(stats.total)}</td>
      <td className="right num">{whole(stats.mean)}</td>
      <td className="right num">{whole(stats.stdev)}</td>
      <td className="right num">{percent(stats.cv)}</td>
      <td className="right num">
        {whole(stats.min)} – {whole(stats.max)}
      </td>
      <td className={`right num ${stats.slope > 0 ? "delta-down" : stats.slope < 0 ? "delta-up" : ""}`}>
        {enough ? change(stats.slope) : dash}
      </td>
      <td className="right num">{enough ? percent(stats.yearly, true) : dash}</td>
      <td className="right num">{enough ? stats.r2.toFixed(2) : dash}</td>
      <td className="right num">{enough ? whole(projection(stats, ahead).reduce((sum, v) => sum + v, 0)) : dash}</td>
    </tr>
  );
}

function AllNone({ onAll, onNone }: { onAll: () => void; onNone: () => void }) {
  return (
    <div className="row">
      <button className="btn small" onClick={onAll}>
        {t("analysis.all")}
      </button>
      <button className="btn small" onClick={onNone}>
        {t("analysis.none")}
      </button>
    </div>
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
