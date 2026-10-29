// The budget: what comes in and goes out of the accounts each month, by category and by
// payee, from the transactions the source lists (Finary leaves out transfers between the
// user's own accounts).
import { amount } from "./analytics";
import type { Slice } from "./analytics";
import type { AccountTransaction } from "./types";

export const UNCATEGORISED = "__none";

export interface BudgetMonth {
  month: string; // YYYY-MM
  income: number; // euros in
  spending: number; // euros out, as a positive amount
}

export interface Payee {
  label: string;
  spending: number;
  count: number;
}

export interface Budget {
  months: BudgetMonth[]; // oldest first, the current month last (still under way)
  full: number; // months before the current one, which the averages cover
  income: number; // a month on average, over the full months
  spending: number;
  categories: Slice[]; // spending by category over the months, largest first (key UNCATEGORISED when none)
  payees: Payee[]; // largest spending first
  transactions: AccountTransaction[]; // over the months, newest first
}

/** The month `n` months before `month` (YYYY-MM). */
function monthsBefore(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 - n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * The budget over the `count` calendar months ending with `today`'s, from the transactions of
 * `accounts` (ids). Positive amounts are income, negative ones spending; the source's
 * currency is taken as euros.
 */
export function budget(transactions: AccountTransaction[], accounts: Set<string>, today: string, count: number): Budget {
  const current = today.slice(0, 7);
  const months = Array.from({ length: count }, (_, i) => ({ month: monthsBefore(current, count - 1 - i), income: 0, spending: 0 }));
  const first = months[0]!.month;
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const categories = new Map<string, number>();
  const payees = new Map<string, Payee>();
  const kept: AccountTransaction[] = [];

  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7);
    if (!accounts.has(transaction.account_id) || month < first || month > current) continue;
    const value = amount(transaction.amount);
    const entry = byMonth.get(month)!;
    kept.push(transaction);
    if (value >= 0) {
      entry.income += value;
      continue;
    }
    entry.spending -= value;
    const category = transaction.category || UNCATEGORISED;
    categories.set(category, (categories.get(category) ?? 0) - value);
    const payee = payees.get(transaction.label) ?? { label: transaction.label, spending: 0, count: 0 };
    payee.spending -= value;
    payee.count += 1;
    payees.set(transaction.label, payee);
  }

  // The current month isn't over: averages leave it out, unless it is all there is.
  const full = Math.max(count - 1, 0);
  const averaged = full ? months.slice(0, full) : months;
  const average = (key: "income" | "spending") => averaged.reduce((sum, m) => sum + m[key], 0) / averaged.length;
  const totalSpending = [...categories.values()].reduce((sum, v) => sum + v, 0);
  return {
    months,
    full,
    income: average("income"),
    spending: average("spending"),
    categories: [...categories]
      .map(([key, value]) => ({ key, value, share: totalSpending ? value / totalSpending : 0 }))
      .sort((a, b) => b.value - a.value),
    payees: [...payees.values()].sort((a, b) => b.spending - a.spending),
    transactions: kept.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
  };
}
