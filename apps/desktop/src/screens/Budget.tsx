// The budget: income and spending a month, where the money goes by category and payee, and
// the transactions behind them, for the accounts and dates picked: from Finary (on plans with
// its budget) or bank exports. Changing a transaction's category sets it for its payee.
import { DEFAULT_CATEGORIES, amount, budget, lastMonths, withRequired } from "@kerfin/core";
import type { AccountTransaction, Categorised, CategoryDef, TransactionsNotice } from "@kerfin/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CategoryEditor } from "../components/CategoryEditor";
import { BarList, ColumnChart } from "../components/charts";
import { useData } from "../data";
import { engine } from "../engine";
import { categoryName, longDate, money, monthName, percent, t } from "../i18n";

// Ranges offered: the last months (counted with the current one), this year, last year, or dates.
const PRESETS = ["3", "6", "12", "year", "lastYear", "custom"] as const;
type Preset = (typeof PRESETS)[number];
const PAGE = 100;
const EDIT = "__edit"; // the category picker's entry that opens the category editor

type SortKey = "date" | "label" | "category" | "amount";

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a convenience only
  }
}

function rangeOf(preset: Preset, today: string, custom: { from: string; to: string }) {
  const year = Number(today.slice(0, 4));
  if (preset === "year") return { from: `${year}-01-01`, to: today };
  if (preset === "lastYear") return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  if (preset === "custom") return custom;
  return lastMonths(today, Number(preset));
}

const whole = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 });

export function BudgetPage() {
  const { overview } = useData();
  const [transactions, setTransactions] = useState<AccountTransaction[] | null>(null);
  const [notices, setNotices] = useState<TransactionsNotice[]>([]);
  const [rules, setRules] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<CategoryDef[]>(DEFAULT_CATEGORIES);
  const [editing, setEditing] = useState(false);
  const [unselected, setUnselected] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<Preset>(() => stored("kerfin.budgetRange", PRESETS, "12"));
  const today = localToday();
  const [custom, setCustom] = useState(() => lastMonths(today, 3));
  const [category, setCategory] = useState<string | null>(null);
  const [payee, setPayee] = useState<string | null>(null);
  const [payeesBy, setPayeesBy] = useState<"amount" | "count">("amount");
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

  const figures = useMemo(() => {
    if (!transactions || !validRange) return null;
    const all = new Set(accounts.map((a) => a.id));
    const picked = new Set([...all].filter((id) => !unselected.has(id)));
    return {
      all: budget(transactions, all, range, today, rules, categories),
      picked: budget(transactions, picked, range, today, rules, categories),
    };
  }, [transactions, accounts, unselected, range.from, range.to, today, rules, categories, validRange]);

  const dialogs = (
    <CategoryEditor open={editing} categories={categories} onClose={() => setEditing(false)} onSaved={load} />
  );
  const editButton = (
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
          <div className="row">{editButton}</div>
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
        <select
          className="input compact"
          aria-label={t("budget.period")}
          value={preset}
          onChange={(e) => {
            const value = e.target.value as Preset;
            if (value === "custom") setCustom(range);
            setPreset(value);
            remember("kerfin.budgetRange", value);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`budget.range.${p}`, { n: p })}
            </option>
          ))}
        </select>
        {preset === "custom" && (
          <>
            <input
              type="date"
              className="input compact"
              aria-label={t("budget.from")}
              value={custom.from}
              max={custom.to}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
            />
            <span className="muted">–</span>
            <input
              type="date"
              className="input compact"
              aria-label={t("budget.to")}
              value={custom.to}
              min={custom.from}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
            />
          </>
        )}
        {editButton}
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

  const { all, picked } = figures;
  const saved = picked.income - picked.spending;
  const totalSpent = picked.months.reduce((sum, m) => sum + m.spending, 0);
  const averageHelp = picked.full ? t("budget.averageOver", { n: picked.full }) : t("budget.averagePartial");
  const pickedCategory = category && picked.categories.some((c) => c.key === category) ? category : null;
  const pickedPayee = payee && picked.payees.some((p) => p.key === payee) ? payee : null;

  const value = (tx: Categorised) => amount(tx.amount);
  const compare: Record<SortKey, (a: Categorised, b: Categorised) => number> = {
    date: (a, b) => a.date.localeCompare(b.date),
    label: (a, b) => (a.payee || a.label).localeCompare(b.payee || b.label),
    category: (a, b) => nameOf(a.key).localeCompare(nameOf(b.key)),
    amount: (a, b) => value(a) - value(b),
  };
  const rows = picked.transactions
    .filter((tx) => (!pickedCategory || tx.key === pickedCategory) && (!pickedPayee || tx.payeeKey === pickedPayee))
    .sort((a, b) => compare[sort.key](a, b) * (sort.descending ? -1 : 1) || b.date.localeCompare(a.date));

  const totalCount = picked.payees.reduce((sum, p) => sum + p.count, 0);
  const payeeSlices = [...picked.payees]
    .sort((a, b) => (payeesBy === "count" ? b.count - a.count || b.spending - a.spending : b.spending - a.spending))
    .slice(0, 12)
    .map((p) =>
      payeesBy === "count"
        ? { key: p.key, value: p.count, share: totalCount ? p.count / totalCount : 0 }
        : { key: p.key, value: p.spending, share: totalSpent ? p.spending / totalSpent : 0 },
    );
  const payeeNames = new Map(picked.payees.map((p) => [p.key, p.label]));

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

  const toggle = (id: string) =>
    setUnselected((off) => {
      const next = new Set(off);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = unselected.size === 0;

  return (
    <>
      {header}
      {dialogs}

      <div className="kpi-row">
        <Kpi label={t("budget.income")} value={whole(picked.income)} detail={averageHelp} />
        <Kpi label={t("budget.spending")} value={whole(picked.spending)} detail={averageHelp} />
        <Kpi
          label={t("budget.saved")}
          value={money(saved, "EUR", { maximumFractionDigits: 0, signDisplay: "exceptZero" })}
          detail={picked.income > 0 ? t("budget.savedRate", { rate: percent(saved / picked.income) }) : averageHelp}
        />
        <Kpi
          label={t("budget.spentInRange")}
          value={whole(totalSpent)}
          detail={t("budget.rangeDates", { from: longDate(range.from), to: longDate(range.to) })}
        />
      </div>

      <section className="card">
        <div className="card-header">
          <h2>{t("budget.accounts")}</h2>
        </div>
        <div className="table-scroll">
          <table className="table portfolio">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
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
                const totals = all.byAccount[a.id];
                return (
                  <tr key={a.id} className={unselected.has(a.id) ? "clickable dimmed-row" : "clickable"} onClick={() => toggle(a.id)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={a.label}
                        checked={!unselected.has(a.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(a.id)}
                      />
                    </td>
                    <td>
                      <div>{a.label}</div>
                      <div className="muted small">{a.institution_name}</div>
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

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>{t("budget.byMonth")}</h2>
          </div>
          <ColumnChart
            columns={picked.months.map((m) => ({ key: m.month, value: m.spending }))}
            label={(month) => monthName(month)}
            title={(month) => monthName(month, true)}
          />
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t("budget.byCategory")}</h2>
            <button className="btn small ghost" onClick={() => setEditing(true)}>
              {t("budget.edit")}
            </button>
          </div>
          <BarList
            slices={picked.categories}
            label={nameOf}
            selected={pickedCategory}
            onSelect={(key) => {
              setCategory(key === pickedCategory ? null : key);
              setShown(PAGE);
            }}
          />
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {t("budget.byCategoryHelp")}
          </p>
        </section>
      </div>

      <div className="split-tables">
        <section className="card">
          <div className="card-header">
            <h2>{t("budget.transactions")}</h2>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {pickedCategory && (
                <button className="btn small ghost" onClick={() => setCategory(null)}>
                  {t("budget.clearFilter", { name: nameOf(pickedCategory) })}
                </button>
              )}
              {pickedPayee && (
                <button className="btn small ghost" onClick={() => setPayee(null)}>
                  {t("budget.clearFilter", { name: payeeNames.get(pickedPayee) ?? pickedPayee })}
                </button>
              )}
            </div>
          </div>
          <div className="table-scroll">
            <table className="table portfolio">
              <thead>
                <tr>
                  {sortHeader("date", t("budget.date"))}
                  {sortHeader("label", t("budget.label"))}
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
                      <td className="num">{longDate(tx.date)}</td>
                      <td className="holding-name">
                        <div>{tx.label}</div>
                        <div className="muted small">
                          {[accounts.length > 1 ? labels.get(tx.account_id) : null, tx.pending ? t("budget.pending") : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td>
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
                        </select>
                        <div className="muted small">{t(`budget.origin.${tx.origin}`)}</div>
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

        <section className="card">
          <div className="card-header">
            <h2>{t("budget.payees")}</h2>
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
          <BarList
            slices={payeeSlices}
            label={(key) => payeeNames.get(key) ?? key}
            format={payeesBy === "count" ? (n) => t("budget.payments", { n }) : undefined}
            selected={pickedPayee}
            onSelect={(key) => {
              setPayee(key === pickedPayee ? null : key);
              setShown(PAGE);
            }}
          />
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {t("budget.payeesHelp")}
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
