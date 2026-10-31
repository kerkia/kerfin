// The budget: income and spending, and how spending moves over time, for the accounts,
// categories and payees picked, and the transactions behind them: from Finary (on plans with
// its budget) or bank exports. The three lists at the top filter each other and the rest; a
// transaction's category, changed here, applies to its payee.
import {
  DEFAULT_CATEGORIES,
  PER_YEAR,
  addPoints,
  amount,
  budget,
  lastMonths,
  projection,
  spendingAnalysis,
  trendAt,
  trendStats,
  withRequired,
} from "@kerfin/core";
import type { AccountTransaction, Categorised, CategoryDef, Flow, SplitBy, Step, TransactionsNotice, TrendStats } from "@kerfin/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CategoryEditor } from "../components/CategoryEditor";
import { PRESETS, PeriodPicker, localToday, rangeOf, remember, stored } from "../components/Period";
import type { Preset } from "../components/Period";
import { TrendChart } from "../components/charts";
import type { TrendSeries } from "../components/charts";
import { useData } from "../data";
import { engine } from "../engine";
import { categoryName, longDate, money, monthName, percent, shortDate, t } from "../i18n";

const PAGE = 100;
const EDIT = "__edit"; // the category picker's entry that opens the category editor
const SPLITS = ["total", "category", "account"] as const;
const AHEAD = ["0", "3", "6", "12", "24"] as const; // months projected; 0 for none
const EVERY = ["auto", "week", "month"] as const; // a point a week or a month; auto: by the period
const WEEKLY_UP_TO = 186; // days: auto draws a point a week over periods up to about six months
const COLORS = 6; // named lines; the rest fold into "Other"
const OTHER = "__other";
const MIN_POINTS = 3; // for a trend worth showing

type SortKey = "date" | "label" | "account" | "category" | "amount";
type FlowKey = "name" | "count" | "in" | "out";
type Sort<K> = { key: K; descending: boolean };

const whole = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 });
// A trend's monthly change: in cents while small, for a slow trend not to read as none.
const change = (value: number) =>
  money(value, "EUR", { signDisplay: "exceptZero", maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0 });

/** `set` with `key` added, or removed if it was in. */
function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function BudgetPage() {
  const { overview } = useData();
  const [transactions, setTransactions] = useState<AccountTransaction[] | null>(null);
  const [notices, setNotices] = useState<TransactionsNotice[]>([]);
  const [rules, setRules] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<CategoryDef[]>(DEFAULT_CATEGORIES);
  const [editing, setEditing] = useState(false);
  const [unselected, setUnselected] = useState<Set<string>>(new Set());
  const [categoriesOut, setCategoriesOut] = useState<Set<string>>(new Set());
  const [payeesOut, setPayeesOut] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<Preset>(() => stored("kerfin.budgetRange", PRESETS, "12"));
  const today = localToday();
  const [custom, setCustom] = useState(() => lastMonths(today, 3));
  const [split, setSplit] = useState<SplitBy>(() => stored("kerfin.budgetSplit", SPLITS, "total"));
  const [ahead, setAhead] = useState(() => stored("kerfin.budgetAhead", AHEAD, "6"));
  const [every, setEvery] = useState(() => stored("kerfin.budgetEvery", EVERY, "auto"));
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "date", descending: true });
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(() => {
    engine.transactions().then(
      (answer) => {
        setTransactions(answer.transactions);
        setNotices(answer.notices);
        setRules(answer.rules);
        setCategories(withRequired(answer.categories ?? DEFAULT_CATEGORIES));
      },
      () => undefined,
    );
  }, []);
  // Reload after each sync or import: the overview changes then.
  useEffect(load, [overview, load]);

  async function recategorise(tx: Categorised, key: string | null) {
    // Shown at once; the engine keeps it for every transaction from this payee.
    setRules((all) => {
      const next = { ...all };
      if (key) next[tx.payeeKey] = key;
      else delete next[tx.payeeKey];
      return next;
    });
    await engine.setCategoryRule(tx.payeeKey, key).catch(load);
  }

  // Accounts with transactions, the hidden ones aside.
  const accounts = useMemo(() => {
    if (!overview || !transactions) return [];
    const listed = new Set(transactions.map((tx) => tx.account_id));
    return overview.accounts.filter((a) => !a.hidden && listed.has(a.id));
  }, [overview, transactions]);
  const first = useMemo(
    () => transactions?.reduce<string | null>((min, tx) => (min === null || tx.date < min ? tx.date : min), null) ?? null,
    [transactions],
  );
  const range = rangeOf(preset, today, custom, first);
  const validRange = range.from <= range.to;
  const step: Step =
    every !== "auto" ? every : (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 <= WEEKLY_UP_TO ? "week" : "month";

  // Each list at the top is filtered by the other two, not by itself, so that more can be picked.
  const figures = useMemo(() => {
    if (!transactions || !validRange) return null;
    const all = new Set(accounts.map((a) => a.id));
    const picked = new Set([...all].filter((id) => !unselected.has(id)));
    const run = (ids: Set<string>, filter = {}) => budget(transactions, ids, range, today, rules, categories, filter);
    const spending = categories.filter((c) => c.kind === "spending").map((c) => c.key);
    return {
      base: run(picked), // income and savings: the accounts' own
      main: run(picked, { categoriesOut, payeesOut }),
      forAccounts: run(all, { categoriesOut, payeesOut }),
      forCategories: run(picked, { payeesOut }),
      forPayees: run(picked, { categoriesOut }),
      analysis: spendingAnalysis(transactions, {
        accounts: picked,
        picked: new Set(spending.filter((key) => !categoriesOut.has(key))),
        payeesOut,
        range,
        today,
        split,
        step,
        rules,
        categories,
      }),
    };
    // The range by its dates: rangeOf gives a new object each render.
  }, [transactions, accounts, unselected, categoriesOut, payeesOut, range.from, range.to, today, rules, categories, split, step, validRange]);

  const dialogs = <CategoryEditor open={editing} categories={categories} onClose={() => setEditing(false)} onSaved={load} />;
  const actions = (
    <button className="btn small" onClick={() => setEditing(true)}>
      {t("budget.editCategories")}
    </button>
  );

  if (!overview || !transactions) return <h1>{t("nav.budget")}</h1>;
  if (accounts.length === 0) {
    return (
      <>
        <div className="page-header">
          <h1>{t("nav.budget")}</h1>
          <div className="row">{actions}</div>
        </div>
        {dialogs}
        <div className="card empty">
          <p className="secondary" style={{ margin: 0 }}>
            {t("budget.empty")}
          </p>
          {notices.map((notice) => (
            <p key={notice.connection_id} className="small" style={{ margin: "10px 0 0" }}>
              {t("budget.finarySays", { note: notice.note || notice.availability })}
            </p>
          ))}
        </div>
      </>
    );
  }

  const byKey = new Map(categories.map((c) => [c.key, c]));
  const nameOf = (key: string) => categoryName(byKey.get(key) ?? { key });
  const excluded = (key: string) => byKey.get(key)?.kind === "excluded";
  const labels = new Map(overview.accounts.map((a) => [a.id, a.label]));

  const header = (
    <div className="page-header">
      <h1>{t("nav.budget")}</h1>
      <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span className="inline-label">
          {t("budget.period")}
          <PeriodPicker
            preset={preset}
            custom={custom}
            range={range}
            storageKey="kerfin.budgetRange"
            onPreset={setPreset}
            onCustom={setCustom}
          />
        </span>
        {actions}
      </div>
    </div>
  );
  if (!figures) {
    return (
      <>
        {header}
        <div className="card empty">
          <p className="secondary" style={{ margin: 0 }}>
            {t("budget.badRange")}
          </p>
        </div>
      </>
    );
  }

  const { base, main, forAccounts, forCategories, forPayees, analysis } = figures;
  const saved = base.income - base.spending;
  const totalSpent = main.months.reduce((sum, m) => sum + m.spending, 0);
  const averageHelp = main.full ? t("budget.averageOver", { n: main.full }) : t("budget.averagePartial");
  const filtered = categoriesOut.size > 0 || payeesOut.size > 0;

  // The chart's lines: the largest named, in the list's order so a line keeps its color as
  // others come and go; the rest added up as "Other".
  const { points } = analysis;
  const ranked = analysis.series;
  const order = split === "account" ? accounts.map((a) => a.id) : categories.map((c) => c.key);
  const named = new Set(ranked.slice(0, ranked.length > COLORS ? COLORS - 1 : COLORS).map((s) => s.key));
  const lines = split === "total" ? [...ranked] : order.flatMap((key) => ranked.filter((s) => s.key === key && named.has(key)));
  const rest = ranked.filter((s) => !named.has(s.key));
  if (rest.length) lines.push({ key: OTHER, values: points.map((_, i) => rest.reduce((sum, s) => sum + s.values[i]!, 0)) });
  const lineName = (key: string) =>
    key === "total"
      ? t("analysis.total")
      : key === OTHER
        ? t("analysis.other")
        : split === "account"
          ? (labels.get(key) ?? key)
          : nameOf(key);
  const perYear = PER_YEAR[step];
  const total = trendStats(
    points.map((_, i) => ranked.reduce((sum, s) => sum + s.values[i]!, 0)),
    perYear,
  );
  const aheadMonths = Number(ahead);
  const count = Math.round((aheadMonths * perYear) / 12); // points projected
  const enough = points.length >= MIN_POINTS;
  const projecting = enough && count > 0;
  const future = projecting ? Array.from({ length: count }, (_, i) => addPoints(points[points.length - 1]!, step, i + 1)) : [];
  const projected = projection(total, count);
  const projectedSum = projected.reduce((sum, v) => sum + v, 0);
  // The total is drawn with its trend; split, each line goes on with its own projection, from
  // its trend at the last point.
  const onwards = (values: number[]) => {
    const stats = trendStats(values, perYear);
    return [trendAt(stats, points.length - 1), ...projection(stats, count)];
  };
  const chartSeries: TrendSeries[] = lines.map((line, i) => ({
    key: line.key,
    label: lineName(line.key),
    color: line.key === OTHER ? "var(--series-other)" : `var(--series-${i + 1})`,
    values: line.values,
    projected: projecting && split !== "total" ? onwards(line.values) : undefined,
  }));
  // Over more than a year, the axis names the years too.
  const longRange = points.length + future.length > perYear;
  const pointLabel = (point: string) =>
    step === "month" ? monthName(point, longRange) : longRange ? longDate(point) : shortDate(point);
  const pointTitle = (point: string) =>
    step === "month" ? monthName(point, true) : t("analysis.weekOf", { date: longDate(point) });
  const aheadPicker = (
    <label className="inline-label">
      {t("analysis.ahead")}
      <select
        className="input compact"
        value={ahead}
        onChange={(e) => {
          setAhead(e.target.value as (typeof AHEAD)[number]);
          remember("kerfin.budgetAhead", e.target.value);
        }}
      >
        {AHEAD.map((n) => (
          <option key={n} value={n}>
            {n === "0" ? t("analysis.aheadNone") : t("analysis.aheadMonths", { n })}
          </option>
        ))}
      </select>
    </label>
  );
  const everyPicker = (
    <label className="inline-label">
      {t("analysis.every")}
      <select
        className="input compact"
        value={every}
        onChange={(e) => {
          setEvery(e.target.value as (typeof EVERY)[number]);
          remember("kerfin.budgetEvery", e.target.value);
        }}
      >
        {EVERY.map((option) => (
          <option key={option} value={option}>
            {t(`analysis.every.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );

  const value = (tx: Categorised) => amount(tx.amount);
  const compare: Record<SortKey, (a: Categorised, b: Categorised) => number> = {
    date: (a, b) => a.date.localeCompare(b.date),
    label: (a, b) => (a.payee || a.label).localeCompare(b.payee || b.label),
    account: (a, b) => (labels.get(a.account_id) ?? "").localeCompare(labels.get(b.account_id) ?? ""),
    category: (a, b) => nameOf(a.key).localeCompare(nameOf(b.key)),
    amount: (a, b) => value(a) - value(b),
  };
  const rows = [...main.transactions].sort(
    (a, b) => compare[sort.key](a, b) * (sort.descending ? -1 : 1) || b.date.localeCompare(a.date),
  );

  function sortHeader(key: SortKey, label: string, right = false) {
    const active = sort.key === key;
    return (
      <th className={right ? "right" : undefined} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
        <button
          className="sort-button"
          onClick={() => setSort({ key, descending: active ? !sort.descending : key === "date" || key === "amount" })}
        >
          {label}
          <span aria-hidden className={active ? "sort-mark" : "sort-mark idle"}>
            {active && !sort.descending ? "↑" : "↓"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <>
      {header}
      {dialogs}

      <div className="budget-filters">
        <FilterTable
          title={t("budget.accounts")}
          nameHeader={t("budget.account")}
          allLabel={t("budget.allAccounts")}
          rows={accounts.map((a) => ({
            key: a.id,
            name: a.label,
            detail: a.institution_name,
            flow: forAccounts.flows.accounts[a.id] ?? NO_FLOW,
          }))}
          out={unselected}
          onOut={setUnselected}
        />
        <FilterTable
          title={t("budget.category")}
          nameHeader={t("budget.category")}
          allLabel={t("budget.allCategories")}
          rows={categories
            .filter((c) => forCategories.flows.categories[c.key])
            .map((c) => ({ key: c.key, name: categoryName(c), flow: forCategories.flows.categories[c.key]! }))}
          out={categoriesOut}
          onOut={(out) => {
            setCategoriesOut(out);
            setShown(PAGE);
          }}
          action={
            <button className="btn small ghost" onClick={() => setEditing(true)}>
              {t("budget.edit")}
            </button>
          }
        />
        <FilterTable
          title={t("budget.payee")}
          nameHeader={t("budget.payee")}
          allLabel={t("budget.allPayees")}
          rows={Object.entries(forPayees.flows.payees).map(([key, flow]) => ({
            key,
            name: forPayees.payeeNames[key] ?? key,
            flow,
          }))}
          out={payeesOut}
          onOut={(out) => {
            setPayeesOut(out);
            setShown(PAGE);
          }}
        />
      </div>
      <p className="muted small" style={{ margin: "-8px 0 0" }}>
        {t("budget.filtersHelp")}
      </p>

      <div className="kpi-row budget-kpis">
        <Kpi label={t("budget.income")} value={whole(base.income)} detail={t("budget.accountsOnly")} />
        <Kpi
          label={t("budget.saved")}
          value={money(saved, "EUR", { maximumFractionDigits: 0, signDisplay: "exceptZero" })}
          detail={base.income > 0 ? t("budget.savedRate", { rate: percent(saved / base.income) }) : t("budget.accountsOnly")}
        />
        <Kpi
          label={t("budget.spending")}
          value={whole(main.spending)}
          detail={filtered ? `${averageHelp} · ${t("budget.filteredNote")}` : averageHelp}
        />
        <Kpi
          label={t("budget.spentInRange")}
          value={whole(totalSpent)}
          detail={t("budget.rangeDates", { from: longDate(range.from), to: longDate(range.to) })}
        />
        <Kpi
          label={t("analysis.trend")}
          value={enough ? t(`analysis.per.${step}`, { amount: change(total.slope) }) : "–"}
          detail={
            enough
              ? t(`analysis.trendDetail.${step}`, { rate: percent(total.yearly, true), r2: total.r2.toFixed(2) })
              : t(`analysis.tooFew.${step}`, { n: MIN_POINTS })
          }
        />
        <Kpi
          label={t("analysis.spread")}
          value={points.length ? whole(total.stdev) : "–"}
          detail={
            points.length
              ? t(`analysis.spreadDetail.${step}`, { cv: percent(total.cv), min: whole(total.min), max: whole(total.max) })
              : t(`analysis.tooFew.${step}`, { n: 1 })
          }
        />
        {count > 0 && (
          <Kpi
            label={t("analysis.projected", { n: aheadMonths })}
            value={projecting ? whole(projectedSum) : "–"}
            detail={
              projecting
                ? t(`analysis.projectedDetail.${step}`, {
                    amount: whole(projected[projected.length - 1]!),
                    when: step === "month" ? monthName(future[future.length - 1]!, true) : longDate(future[future.length - 1]!),
                  })
                : t(`analysis.tooFew.${step}`, { n: MIN_POINTS })
            }
          />
        )}
      </div>

      <div className="budget-analysis">
        <section className="card">
          <div className="card-header">
            <h2>{t("analysis.overTime")}</h2>
            <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
              {everyPicker}
              {aheadPicker}
              <div className="segmented" role="radiogroup" aria-label={t("analysis.split")}>
                {SPLITS.map((by) => (
                  <button
                    key={by}
                    role="radio"
                    aria-checked={split === by}
                    className={split === by ? "segment active" : "segment"}
                    onClick={() => {
                      setSplit(by);
                      remember("kerfin.budgetSplit", by);
                    }}
                  >
                    {t(`analysis.split.${by}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {points.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {t(`analysis.none.${step}`)}
            </p>
          ) : chartSeries.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {t("analysis.nothing")}
            </p>
          ) : (
            <TrendChart
              points={points}
              ahead={future}
              series={chartSeries}
              trend={
                enough && split === "total"
                  ? {
                      values: [...points.map((_, i) => trendAt(total, i)), ...(projecting ? projected : [])],
                      band: total.residual,
                      label: t("analysis.trendLine"),
                    }
                  : undefined
              }
              projectionLabel={t("analysis.projectionMonths", { n: aheadMonths })}
              label={pointLabel}
              title={pointTitle}
            />
          )}
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {!enough && points.length > 0 && `${t(`analysis.needMore.${step}`, { n: MIN_POINTS, have: points.length })} `}
            {t(split === "total" ? "analysis.chartHelp" : "analysis.chartHelpSplit")}
          </p>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t("analysis.statistics")}</h2>
          </div>
          <div className="table-scroll">
            <table className="table portfolio dense">
              <thead>
                <tr>
                  <th>{t(`analysis.split.${split}`)}</th>
                  <th className="right">{t("analysis.col.total")}</th>
                  <th className="right">{t(`analysis.col.average.${step}`)}</th>
                  <th className="right">{t("analysis.col.stdev")}</th>
                  <th className="right">{t("analysis.col.cv")}</th>
                  <th className="right">{t(`analysis.col.range.${step}`)}</th>
                  <th className="right">{t(`analysis.col.trend.${step}`)}</th>
                  <th className="right">{t("analysis.col.yearly")}</th>
                  <th className="right">{t("analysis.col.r2")}</th>
                  {count > 0 && <th className="right">{t("analysis.col.projected", { n: aheadMonths })}</th>}
                </tr>
              </thead>
              <tbody>
                {(split === "total" ? [] : ranked).map((s) => (
                  <StatsRow key={s.key} name={lineName(s.key)} stats={trendStats(s.values, perYear)} ahead={count} enough={enough} />
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
      </div>

      <section className="card">
        <div className="card-header">
          <h2>{t("budget.transactionsCount", { n: rows.length })}</h2>
        </div>
        <div className="table-scroll">
          <table className="table portfolio dense">
            <thead>
              <tr>
                {sortHeader("date", t("budget.date"))}
                {sortHeader("label", t("budget.label"))}
                {sortHeader("account", t("budget.account"))}
                {sortHeader("category", t("budget.category"))}
                {sortHeader("amount", t("budget.amount"), true)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((tx, i) => {
                const left = excluded(tx.key);
                const signed = value(tx);
                return (
                  <tr key={`${tx.account_id}-${tx.date}-${i}`} className={left ? "dimmed-row" : undefined}>
                    <td className="num nowrap">{longDate(tx.date)}</td>
                    <td className="holding-name">
                      {tx.label}
                      {tx.pending && <span className="muted small"> · {t("budget.pending")}</span>}
                    </td>
                    <td className="secondary">{labels.get(tx.account_id)}</td>
                    <td className="nowrap">
                      <select
                        className="input compact category-pick"
                        aria-label={t("budget.category")}
                        title={t("budget.categoryHelp", { payee: tx.payee || tx.payeeKey })}
                        value={tx.origin === "yours" ? tx.key : `auto:${tx.key}`}
                        onChange={(e) => {
                          if (e.target.value === EDIT) setEditing(true);
                          else void recategorise(tx, e.target.value.startsWith("auto:") ? null : e.target.value);
                        }}
                      >
                        {tx.origin !== "yours" && <option value={`auto:${tx.key}`}>{nameOf(tx.key)}</option>}
                        {tx.origin === "yours" && <option value="auto:">{t("budget.resetCategory")}</option>}
                        {categories
                          .filter((c) => tx.origin === "yours" || c.key !== tx.key)
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {categoryName(c)}
                            </option>
                          ))}
                        <option value={EDIT}>{t("budget.editCategoriesOption")}</option>
                      </select>{" "}
                      <span className="muted small">{t(`budget.origin.${tx.origin}`)}</span>
                    </td>
                    <td className={`right num ${left || signed === 0 ? "" : signed > 0 ? "delta-up" : "delta-down"}`}>
                      {money(signed, tx.currency ?? "EUR", { signDisplay: "exceptZero" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > shown && (
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => setShown((n) => n + PAGE)}>
            {t("budget.more", { n: Math.min(PAGE, rows.length - shown) })}
          </button>
        )}
        <p className="muted small" style={{ margin: "10px 0 0" }}>
          {t("budget.sources")}
        </p>
      </section>
    </>
  );
}

const NO_FLOW: Flow = { count: 0, in: 0, out: 0 };

/**
 * A filter as a table: a row per account, category or payee with its money in and out,
 * ticked to keep it; the header's box ticks or unticks every row. Sortable by any column.
 */
function FilterTable({
  title,
  nameHeader,
  allLabel,
  rows,
  out,
  onOut,
  action,
}: {
  title: string;
  nameHeader: string;
  allLabel: string;
  rows: { key: string; name: string; detail?: string | null; flow: Flow }[];
  out: ReadonlySet<string>; // the rows left out
  onOut: (out: Set<string>) => void;
  action?: React.ReactNode;
}) {
  const [sort, setSort] = useState<Sort<FlowKey>>({ key: "out", descending: true });
  type Row = (typeof rows)[number];
  const compare: Record<FlowKey, (a: Row, b: Row) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    count: (a, b) => a.flow.count - b.flow.count,
    in: (a, b) => a.flow.in - b.flow.in,
    out: (a, b) => a.flow.out - b.flow.out,
  };
  const sorted = [...rows].sort((a, b) => compare[sort.key](a, b) * (sort.descending ? -1 : 1) || a.name.localeCompare(b.name));
  const maxOut = Math.max(...rows.map((r) => r.flow.out), 1);
  const kept = rows.filter((r) => !out.has(r.key)).length;
  const all = kept === rows.length;

  function head(key: FlowKey, label: string, className: string, title?: string) {
    const active = sort.key === key;
    return (
      <th className={className} title={title} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
        <button className="sort-button" onClick={() => setSort({ key, descending: active ? !sort.descending : key !== "name" })}>
          {label}
          <span aria-hidden className={active ? "sort-mark" : "sort-mark idle"}>
            {active && !sort.descending ? "↑" : "↓"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="filter-scroll">
        <table className="table portfolio dense sticky-head">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  aria-label={allLabel}
                  checked={all && rows.length > 0}
                  ref={(box) => {
                    if (box) box.indeterminate = !all && kept > 0;
                  }}
                  onChange={() => {
                    const next = new Set(out);
                    for (const row of rows) {
                      if (all) next.add(row.key);
                      else next.delete(row.key);
                    }
                    onOut(next);
                  }}
                />
              </th>
              {head("name", nameHeader, "")}
              {head("count", t("budget.countShort"), "right col-count", t("budget.count"))}
              {head("in", t("budget.in"), "right col-money")}
              {head("out", t("budget.out"), "right col-money")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const left = out.has(row.key);
              const toggle = () => onOut(toggled(out, row.key));
              return (
                <tr key={row.key} className={left ? "clickable dimmed-row" : "clickable"} onClick={toggle}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={row.name}
                      checked={!left}
                      onClick={(e) => e.stopPropagation()}
                      onChange={toggle}
                    />
                  </td>
                  <td className="filter-name" title={row.name}>
                    {row.name}
                    {row.detail && <span className="muted small"> · {row.detail}</span>}
                  </td>
                  <td className="right num">{row.flow.count}</td>
                  <td className="right num">{row.flow.in ? whole(row.flow.in) : ""}</td>
                  <td
                    className="right num share-cell"
                    style={{ "--share": `${(row.flow.out / maxOut) * 100}%` } as React.CSSProperties}
                  >
                    {row.flow.out ? whole(row.flow.out) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
      <td className="right num nowrap">
        {whole(stats.min)} – {whole(stats.max)}
      </td>
      <td className={`right num ${!enough ? "" : stats.slope > 0 ? "delta-down" : stats.slope < 0 ? "delta-up" : ""}`}>
        {enough ? change(stats.slope) : dash}
      </td>
      <td className="right num">{enough ? percent(stats.yearly, true) : dash}</td>
      <td className="right num">{enough ? stats.r2.toFixed(2) : dash}</td>
      {ahead > 0 && (
        <td className="right num">{enough ? whole(projection(stats, ahead).reduce((sum, v) => sum + v, 0)) : dash}</td>
      )}
    </tr>
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
