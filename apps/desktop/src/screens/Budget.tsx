// The budget: income and spending a month, where the money goes by category and payee, and
// the transactions behind them, from what Finary lists for the accounts its budget covers.
import { UNCATEGORISED, amount, budget } from "@kerfin/core";
import type { AccountTransaction, TransactionsNotice } from "@kerfin/core";
import { useEffect, useMemo, useState } from "react";

import { BarList, ColumnChart } from "../components/charts";
import { useData } from "../data";
import { engine } from "../engine";
import { longDate, money, monthName, percent, t } from "../i18n";

const PERIODS = [3, 6, 12] as const;
const PAGE = 100;

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function storedPeriod(): number {
  try {
    const value = Number(localStorage.getItem("kerfin.budgetMonths"));
    return (PERIODS as readonly number[]).includes(value) ? value : 12;
  } catch {
    return 12;
  }
}

const whole = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 });

export function BudgetPage() {
  const { overview } = useData();
  const [transactions, setTransactions] = useState<AccountTransaction[] | null>(null);
  const [notices, setNotices] = useState<TransactionsNotice[]>([]);
  const [accountId, setAccountId] = useState("");
  const [months, setMonths] = useState(storedPeriod);
  const [category, setCategory] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  // Reload after each sync: the overview changes then.
  useEffect(() => {
    engine.transactions().then(
      (answer) => {
        setTransactions(answer.transactions);
        setNotices(answer.notices);
      },
      () => undefined,
    );
  }, [overview]);

  // Accounts with transactions, the hidden ones aside.
  const accounts = useMemo(() => {
    if (!overview || !transactions) return [];
    const listed = new Set(transactions.map((tx) => tx.account_id));
    return overview.accounts.filter((a) => !a.hidden && listed.has(a.id));
  }, [overview, transactions]);
  const selected = accounts.find((a) => a.id === accountId);

  const figures = useMemo(() => {
    if (!transactions) return null;
    const ids = new Set(selected ? [selected.id] : accounts.map((a) => a.id));
    return budget(transactions, ids, localToday(), months);
  }, [transactions, accounts, selected, months]);

  if (!overview || !figures) return <h1>{t("nav.budget")}</h1>;
  if (accounts.length === 0) {
    return (
      <>
        <h1>{t("nav.budget")}</h1>
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

  const labels = new Map(overview.accounts.map((a) => [a.id, a.label]));
  const categoryName = (key: string) => (key === UNCATEGORISED ? t("budget.uncategorised") : key);
  const picked = category && figures.categories.some((c) => c.key === category) ? category : null;
  const rows = picked
    ? figures.transactions.filter((tx) => (tx.category || UNCATEGORISED) === picked && amount(tx.amount) < 0)
    : figures.transactions;
  const current = figures.months[figures.months.length - 1]!;
  const saved = figures.income - figures.spending;
  const averageHelp = t("budget.averageOver", { n: figures.full || 1 });

  return (
    <>
      <div className="page-header">
        <h1>{t("nav.budget")}</h1>
        <div className="row">
          {accounts.length > 1 && (
            <select className="input compact" aria-label={t("budget.account")} value={selected?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{t("budget.allAccounts")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
          <select
            className="input compact"
            aria-label={t("budget.period")}
            value={months}
            onChange={(e) => {
              const value = Number(e.target.value);
              setMonths(value);
              try {
                localStorage.setItem("kerfin.budgetMonths", String(value));
              } catch {
                // a convenience only
              }
            }}
          >
            {PERIODS.map((n) => (
              <option key={n} value={n}>
                {t("budget.months", { n })}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label={t("budget.income")} value={whole(figures.income)} detail={averageHelp} />
        <Kpi label={t("budget.spending")} value={whole(figures.spending)} detail={averageHelp} />
        <Kpi
          label={t("budget.saved")}
          value={money(saved, "EUR", { maximumFractionDigits: 0, signDisplay: "exceptZero" })}
          detail={figures.income > 0 ? t("budget.savedRate", { rate: percent(saved / figures.income) }) : averageHelp}
        />
        <Kpi
          label={t("budget.thisMonth")}
          value={whole(current.spending)}
          detail={figures.spending > 0 ? t("budget.thisMonthHelp", { share: percent(current.spending / figures.spending) }) : monthName(current.month, true)}
        />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>{t("budget.byMonth")}</h2>
          </div>
          <ColumnChart
            columns={figures.months.map((m) => ({ key: m.month, value: m.spending }))}
            label={(month) => monthName(month)}
            title={(month) => monthName(month, true)}
          />
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {t("budget.byMonthHelp")}
          </p>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t("budget.byCategory")}</h2>
          </div>
          <BarList
            slices={figures.categories}
            label={categoryName}
            selected={picked}
            onSelect={(key) => {
              setCategory(key === picked ? null : key);
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
            <h2>{picked ? t("budget.transactionsIn", { category: categoryName(picked) }) : t("budget.transactions")}</h2>
            {picked && (
              <button className="btn small ghost" onClick={() => setCategory(null)}>
                {t("budget.allCategories")}
              </button>
            )}
          </div>
          <div className="table-scroll">
            <table className="table portfolio">
              <thead>
                <tr>
                  <th>{t("budget.date")}</th>
                  <th>{t("budget.label")}</th>
                  <th>{t("budget.category")}</th>
                  <th className="right">{t("budget.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((tx, i) => (
                  <tr key={`${tx.account_id}-${tx.date}-${i}`}>
                    <td className="num">{longDate(tx.date)}</td>
                    <td className="holding-name">
                      <div>{tx.label}</div>
                      <div className="muted small">
                        {[selected ? null : labels.get(tx.account_id), tx.pending ? t("budget.pending") : null].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="secondary">{categoryName(tx.category || UNCATEGORISED)}</td>
                    <td className="right num">{money(amount(tx.amount), tx.currency ?? "EUR", { signDisplay: "exceptZero" })}</td>
                  </tr>
                ))}
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
          </div>
          <div className="table-scroll">
            <table className="table portfolio">
              <thead>
                <tr>
                  <th>{t("budget.payee")}</th>
                  <th className="right">{t("budget.count")}</th>
                  <th className="right">{t("budget.total")}</th>
                </tr>
              </thead>
              <tbody>
                {figures.payees.slice(0, 15).map((payee) => (
                  <tr key={payee.label}>
                    <td className="holding-name">{payee.label}</td>
                    <td className="right num">{payee.count}</td>
                    <td className="right num">{whole(payee.spending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
