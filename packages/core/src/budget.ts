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

export interface Budget {
  months: BudgetMonth[]; // oldest first, the current month last (still under way)
  full: number; // months before the current one, which the averages cover
  income: number; // a month on average, over the full months
  spending: number;
  categories: Slice[]; // spending by category over the months, largest first
  payees: Payee[]; // largest spending first
  transactions: Categorised[]; // over the months, newest first
}

/** The month `n` months before `month` (YYYY-MM). */
function monthsBefore(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 - n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * The budget over the `count` calendar months ending with `today`'s, from the transactions of
 * `accounts` (ids), categorised with the user's `rules` and `categories`. The source's
 * currency is taken as euros.
 */
export function budget(
  transactions: AccountTransaction[],
  accounts: Set<string>,
  today: string,
  count: number,
  rules: Record<string, string> = {},
  categories: CategoryDef[] = DEFAULT_CATEGORIES,
): Budget {
  const current = today.slice(0, 7);
  const months = Array.from({ length: count }, (_, i) => ({ month: monthsBefore(current, count - 1 - i), income: 0, spending: 0 }));
  const first = months[0]!.month;
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const kinds = new Map(categories.map((c) => [c.key, c.kind]));
  const totals = new Map<string, number>();
  const payees = new Map<string, Payee>();

  // Every account's transactions are categorised together, for transfers to find their pair.
  const kept = categorise(
    transactions.filter((tx) => tx.date.slice(0, 7) >= first && tx.date.slice(0, 7) <= current),
    rules,
    categories,
  )
    .filter((tx) => accounts.has(tx.account_id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  for (const tx of kept) {
    const value = amount(tx.amount);
    const kind = kinds.get(tx.key) ?? "spending";
    const entry = byMonth.get(tx.date.slice(0, 7))!;
    if (kind === "excluded") continue;
    if (kind === "income" || (value > 0 && tx.origin === "none")) {
      // Income, or money in that nothing categorises (else a refund).
      entry.income += value;
      continue;
    }
    // Spending, less refunds.
    entry.spending -= value;
    totals.set(tx.key, (totals.get(tx.key) ?? 0) - value);
    if (value < 0) {
      const payee = payees.get(tx.payeeKey) ?? { key: tx.payeeKey, label: tx.payee || tx.label, spending: 0, count: 0 };
      payee.spending -= value;
      payee.count += 1;
      payees.set(tx.payeeKey, payee);
    }
  }

  // The current month isn't over: averages leave it out, unless it is all there is.
  const full = Math.max(count - 1, 0);
  const averaged = full ? months.slice(0, full) : months;
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
  };
}
