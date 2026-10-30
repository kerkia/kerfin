// The budget: what comes in and goes out of the accounts each month, by category and by
// payee. Transfers between the user's own accounts (and any category the user excludes)
// count as neither; a refund in a spending category lowers that category's spending.
import { amount } from "./analytics";
import type { Slice } from "./analytics";
import { DEFAULT_CATEGORIES, categorise } from "./categories";
import type { Categorised, CategoryDef } from "./categories";
import type { AccountTransaction } from "./types";

export interface BudgetMonth {
  month: string; // YYYY-MM
  income: number; // euros in
  spending: number; // euros out, as a positive amount
}

export interface Payee {
  key: string;
  label: string; // as the latest transaction names it
  spending: number;
  count: number;
}

/** Categories and payees (payee keys) to keep; none given, or empty, keeps them all. */
export interface BudgetFilter {
  categories?: ReadonlySet<string> | null;
  payees?: ReadonlySet<string> | null;
}

/** Whether a categorised transaction passes `filter`. */
export function passes(tx: Categorised, filter: BudgetFilter): boolean {
  return (!filter.categories?.size || filter.categories.has(tx.key)) && (!filter.payees?.size || filter.payees.has(tx.payeeKey));
}

export interface Budget {
  months: BudgetMonth[]; // the range's calendar months, oldest first
  full: number; // the months the range covers whole and that are over, which the averages cover
  income: number; // a month on average, over the full months
  spending: number;
  categories: Slice[]; // spending by category over the months, largest first
  payees: Payee[]; // largest spending first
  transactions: Categorised[]; // over the range, newest first
  byAccount: Record<string, { income: number; spending: number; count: number }>; // over the range
}

/** The month `n` months after `month` (YYYY-MM); `n` may be negative. */
export function addMonths(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The last day of a month (YYYY-MM), as YYYY-MM-DD. */
function monthEnd(month: string): string {
  const day = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return day.toISOString().slice(0, 10);
}

/** The `count` calendar months ending with `today`'s, as a date range. */
export function lastMonths(today: string, count: number): { from: string; to: string } {
  return { from: `${addMonths(today.slice(0, 7), 1 - count)}-01`, to: today };
}

/**
 * The budget from `from` to `to` (YYYY-MM-DD, both included) as of `today`, from the
 * transactions of `accounts` (ids), categorised with the user's `rules` and `categories`,
 * kept to those that pass `filter`. The source's currency is taken as euros.
 */
export function budget(
  transactions: AccountTransaction[],
  accounts: Set<string>,
  range: { from: string; to: string },
  today: string,
  rules: Record<string, string> = {},
  categories: CategoryDef[] = DEFAULT_CATEGORIES,
  filter: BudgetFilter = {},
): Budget {
  const { from, to } = range;
  const months: BudgetMonth[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7) && months.length < 600; month = addMonths(month, 1)) {
    months.push({ month, income: 0, spending: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const kinds = new Map(categories.map((c) => [c.key, c.kind]));
  const totals = new Map<string, number>();
  const payees = new Map<string, Payee>();
  const byAccount: Budget["byAccount"] = {};

  // Every account's transactions are categorised together, for transfers to find their pair.
  const kept = categorise(
    transactions.filter((tx) => tx.date.slice(0, 10) >= from && tx.date.slice(0, 10) <= to),
    rules,
    categories,
  )
    .filter((tx) => accounts.has(tx.account_id) && passes(tx, filter))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  for (const tx of kept) {
    const value = amount(tx.amount);
    const kind = kinds.get(tx.key) ?? "spending";
    const entry = byMonth.get(tx.date.slice(0, 7))!;
    const account = (byAccount[tx.account_id] ??= { income: 0, spending: 0, count: 0 });
    account.count += 1;
    if (kind === "excluded") continue;
    if (kind === "income" || (value > 0 && tx.origin === "none")) {
      // Income, or money in that nothing categorises (else a refund).
      entry.income += value;
      account.income += value;
      continue;
    }
    // Spending, less refunds.
    entry.spending -= value;
    account.spending -= value;
    totals.set(tx.key, (totals.get(tx.key) ?? 0) - value);
    if (value < 0) {
      const payee = payees.get(tx.payeeKey) ?? { key: tx.payeeKey, label: tx.payee || tx.label, spending: 0, count: 0 };
      payee.spending -= value;
      payee.count += 1;
      payees.set(tx.payeeKey, payee);
    }
  }

  // Averages cover the months the range spans whole and that are over, unless there are none.
  const whole = months.filter((m) => `${m.month}-01` >= from && monthEnd(m.month) <= to && monthEnd(m.month) < today);
  const full = whole.length;
  const averaged = full ? whole : months;
  const average = (key: "income" | "spending") => averaged.reduce((sum, m) => sum + m[key], 0) / averaged.length;
  const spent = [...totals.values()].filter((v) => v > 0).reduce((sum, v) => sum + v, 0);
  return {
    months,
    full,
    income: average("income"),
    spending: average("spending"),
    categories: [...totals]
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({ key, value, share: spent ? value / spent : 0 }))
      .sort((a, b) => b.value - a.value),
    payees: [...payees.values()].sort((a, b) => b.spending - a.spending),
    transactions: kept,
    byAccount,
  };
}
