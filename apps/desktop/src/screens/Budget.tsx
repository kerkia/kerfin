// The budget: income and spending, and how spending moves over time, for the accounts,
// categories and payees picked, and the transactions behind them: from Finary (on plans with
// its budget) or bank exports. The three lists at the top filter each other and the rest; a
// transaction's category, changed here, applies to its payee.
import {
  DEFAULT_CATEGORIES,
  addMonths,
  amount,
  budget,
  lastMonths,
  projection,
  spendingAnalysis,
  trendAt,
  trendStats,
  withRequired,
} from "@kerfin/core";
import type { AccountTransaction, Categorised, CategoryDef, SplitBy, TransactionsNotice, TrendStats } from "@kerfin/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CategoryEditor } from "../components/CategoryEditor";
import { ImportTransactions } from "../components/ImportFile";
import { PRESETS, PeriodPicker, localToday, rangeOf, remember, stored } from "../components/Period";
import type { Preset } from "../components/Period";
import { BarList, TrendChart } from "../components/charts";
import type { TrendSeries } from "../components/charts";
import { useData } from "../data";
import { engine } from "../engine";
import { categoryName, longDate, money, monthName, percent, t } from "../i18n";

const PAGE = 100;
const EDIT = "__edit"; // the category picker's entry that opens the category editor
const PAYEES = 25; // payees listed, besides those picked
const SPLITS = ["total", "category", "account"] as const;
const AHEAD = ["3", "6", "12"] as const;
const COLORS = 6; // named lines; the rest fold into "Other"
const OTHER = "__other";
const MIN_MONTHS = 3; // for a trend worth showing

type SortKey = "date" | "label" | "account" | "category" | "amount";

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
  const [importing, setImporting] = useState(false);
  const [unselected, setUnselected] = useState<Set<string>>(new Set());
  const [pickedCategories, setPickedCategories] = useState<Set<string>>(new Set());
  const [pickedPayees, setPickedPayees] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<Preset>(() => stored("kerfin.budgetRange", PRESETS, "12"));
  const today = localToday();
  const [custom, setCustom] = useState(() => lastMonths(today, 3));
  const [payeesBy, setPayeesBy] = useState<"amount" | "count">("amount");
  const [split, setSplit] = useState<SplitBy>(() => stored("kerfin.budgetSplit", SPLITS, "total"));
  const [ahead, setAhead] = useState(() => stored("kerfin.budgetAhead", AHEAD, "6"));
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
  const range = rangeOf(preset, today, custom);
  const validRange = range.from <= range.to;

  // Each list at the top is filtered by the other two, not by itself, so that more can be picked.
  const figures = useMemo(() => {
    if (!transactions || !validRange) return null;
    const all = new Set(accounts.map((a) => a.id));
    const picked = new Set([...all].filter((id) => !unselected.has(id)));
    const run = (ids: Set<string>, filter = {}) => budget(transactions, ids, range, today, rules, categories, filter);
    const spending = categories.filter((c) => c.kind === "spending").map((c) => c.key);
    return {
      base: run(picked), // income and savings: the accounts' own
      main: run(picked, { categories: pickedCategories, payees: pickedPayees }),
      forAccounts: run(all, { categories: pickedCategories, payees: pickedPayees }),
      forCategories: run(picked, { payees: pickedPayees }),
      forPayees: run(picked, { categories: pickedCategories }),
      analysis: spendingAnalysis(transactions, {
        accounts: picked,
        picked: new Set(pickedCategories.size ? spending.filter((key) => pickedCategories.has(key)) : spending),
        payees: pickedPayees,
        range,
        today,
        split,
        rules,
        categories,
      }),
    };
    // The range by its dates: rangeOf gives a new object each render.
  }, [transactions, accounts, unselected, pickedCategories, pickedPayees, range.from, range.to, today, rules, categories, split, validRange]);

  const dialogs = (
    <>
      <CategoryEditor open={editing} categories={categories} onClose={() => setEditing(false)} onSaved={load} />
      <ImportTransactions open={importing} onClose={() => setImporting(false)} />
    </>
  );
  const actions = (
    <>
      <button className="btn small" onClick={() => setImporting(true)}>
        {t("import.updateButton")}
      </button>
      <button className="btn small" onClick={() => setEditing(true)}>
        {t("budget.editCategories")}
      </button>
    </>
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
        <PeriodPicker
          preset={preset}
          custom={custom}
          range={range}
          storageKey="kerfin.budgetRange"
          onPreset={setPreset}
          onCustom={setCustom}
        />
        <select
          className="input compact"
          aria-label={t("analysis.ahead")}
          value={ahead}
          onChange={(e) => {
            setAhead(e.target.value as (typeof AHEAD)[number]);
            remember("kerfin.budgetAhead", e.target.value);
          }}
        >
          {AHEAD.map((n) => (
            <option key={n} value={n}>
              {t("analysis.aheadMonths", { n })}
            </option>
          ))}
        </select>
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
  const filtered = pickedCategories.size > 0 || pickedPayees.size > 0;

  // The lists: payees by amount or number, the largest first, with those picked kept in.
  const payeeTotal = forPayees.payees.reduce((sum, p) => sum + (payeesBy === "count" ? p.count : p.spending), 0);
  const payeeSlices = [...forPayees.payees]
    .sort((a, b) => (payeesBy === "count" ? b.count - a.count || b.spending - a.spending : b.spending - a.spending))
    .filter((p, i) => i < PAYEES || pickedPayees.has(p.key))
    .map((p) => {
      const value = payeesBy === "count" ? p.count : p.spending;
      return { key: p.key, value, share: payeeTotal ? value / payeeTotal : 0 };
    });
  const payeeNames = new Map([...forPayees.payees, ...main.payees].map((p) => [p.key, p.label]));

  // The chart's lines: the largest named, in the list's order so a line keeps its color as
  // others come and go; the rest added up as "Other".
  const { months } = analysis;
  const ranked = analysis.series;
  const order = split === "account" ? accounts.map((a) => a.id) : categories.map((c) => c.key);
  const named = new Set(ranked.slice(0, ranked.length > COLORS ? COLORS - 1 : COLORS).map((s) => s.key));
  const lines = split === "total" ? [...ranked] : order.flatMap((key) => ranked.filter((s) => s.key === key && named.has(key)));
  const rest = ranked.filter((s) => !named.has(s.key));
  if (rest.length) lines.push({ key: OTHER, values: months.map((_, i) => rest.reduce((sum, s) => sum + s.values[i]!, 0)) });
  const lineName = (key: string) =>
    key === "total"
      ? t("analysis.total")
      : key === OTHER
        ? t("analysis.other")
        : split === "account"
          ? (labels.get(key) ?? key)
          : nameOf(key);
  const chartSeries: TrendSeries[] = lines.map((line, i) => ({
    key: line.key,
    label: lineName(line.key),
    color: line.key === OTHER ? "var(--series-other)" : `var(--series-${i + 1})`,
    values: line.values,
  }));

  const total = trendStats(months.map((_, i) => ranked.reduce((sum, s) => sum + s.values[i]!, 0)));
  const count = Number(ahead);
  const future = months.length ? Array.from({ length: count }, (_, i) => addMonths(months[months.length - 1]!, i + 1)) : [];
  const enough = months.length >= MIN_MONTHS;
  // The trend and projection are drawn for the total; split, each line's are in the table.
  const trendShown = enough && split === "total";
  const projected = projection(total, count);
  const projectedSum = projected.reduce((sum, v) => sum + v, 0);

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

  const allSelected = unselected.size === 0;
  const pick = (set: typeof setPickedCategories, key: string) => {
    set((picked) => toggled(picked, key));
    setShown(PAGE);
  };
  const clear = (set: typeof setPickedCategories) => (
    <button className="btn small ghost" onClick={() => set(new Set())}>
      {t("budget.clearPicked")}
    </button>
  );

  return (
    <>
      {header}
      {dialogs}

      <div className="budget-filters">
        <section className="card">
          <div className="card-header">
            <h2>{t("budget.accounts")}</h2>
          </div>
          <div className="filter-scroll">
            <table className="table portfolio dense">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      aria-label={t("budget.allAccounts")}
                      checked={allSelected}
                      ref={(box) => {
                        if (box) box.indeterminate = !allSelected && unselected.size < accounts.length;
                      }}
                      onChange={() => setUnselected(allSelected ? new Set(accounts.map((a) => a.id)) : new Set())}
                    />
                  </th>
                  <th>{t("budget.account")}</th>
                  <th className="right">{t("budget.count")}</th>
                  <th className="right">{t("budget.in")}</th>
                  <th className="right">{t("budget.out")}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const totals = forAccounts.byAccount[a.id];
                  const toggle = () => setUnselected((off) => toggled(off, a.id));
                  return (
                    <tr key={a.id} className={unselected.has(a.id) ? "clickable dimmed-row" : "clickable"} onClick={toggle}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={a.label}
                          checked={!unselected.has(a.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={toggle}
                        />
                      </td>
                      <td>
                        {a.label}
                        <span className="muted small"> · {a.institution_name}</span>
                      </td>
                      <td className="right num">{totals?.count ?? 0}</td>
                      <td className="right num">{whole(totals?.income ?? 0)}</td>
                      <td className="right num">{whole(totals?.spending ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t("budget.byCategory")}</h2>
            <div className="row">
              {pickedCategories.size > 0 && clear(setPickedCategories)}
              <button className="btn small ghost" onClick={() => setEditing(true)}>
                {t("budget.edit")}
              </button>
            </div>
          </div>
          <div className="filter-scroll">
            <BarList
              slices={forCategories.categories}
              label={nameOf}
              selected={pickedCategories}
              onSelect={(key) => pick(setPickedCategories, key)}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t("budget.payees")}</h2>
            <div className="row">
              {pickedPayees.size > 0 && clear(setPickedPayees)}
              <div className="segmented" role="radiogroup" aria-label={t("budget.payeesBy")}>
                {(["amount", "count"] as const).map((by) => (
                  <button
                    key={by}
                    role="radio"
                    aria-checked={payeesBy === by}
                    className={payeesBy === by ? "segment active" : "segment"}
                    onClick={() => setPayeesBy(by)}
                  >
                    {t(`budget.payeesBy.${by}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="filter-scroll">
            <BarList
              slices={payeeSlices}
              label={(key) => payeeNames.get(key) ?? key}
              format={payeesBy === "count" ? (n) => t("budget.payments", { n }) : undefined}
              selected={pickedPayees}
              onSelect={(key) => pick(setPickedPayees, key)}
            />
          </div>
        </section>
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
          value={enough ? t("analysis.perMonth", { amount: change(total.slope) }) : "–"}
          detail={
            enough
              ? t("analysis.trendDetail", { rate: percent(total.yearly, true), r2: total.r2.toFixed(2) })
              : t("analysis.tooFew", { n: MIN_MONTHS })
          }
        />
        <Kpi
          label={t("analysis.spread")}
          value={months.length ? whole(total.stdev) : "–"}
          detail={
            months.length
              ? t("analysis.spreadDetail", { cv: percent(total.cv), min: whole(total.min), max: whole(total.max) })
              : t("analysis.tooFew", { n: 1 })
          }
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

      <div className="budget-analysis">
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
                    remember("kerfin.budgetSplit", by);
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
          {months.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {t("analysis.noMonths")}
            </p>
          ) : chartSeries.length === 0 ? (
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
            <table className="table portfolio dense">
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
                  <StatsRow key={s.key} name={lineName(s.key)} stats={trendStats(s.values)} ahead={count} enough={enough} />
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
      <td className="right num">{enough ? whole(projection(stats, ahead).reduce((sum, v) => sum + v, 0)) : dash}</td>
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
