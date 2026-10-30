// Spending analysis: spending a month for the accounts and categories picked, as a total or
// split by category or by account, and each series' statistics: average, spread, the trend a
// least-squares line gives, and where that trend leads. Spending is counted as in the budget:
// spending categories only, refunds lowering them. Only months that are over count, so a
// month under way doesn't read as a drop.
import { amount } from "./analytics";
import { addMonths, passes } from "./budget";
import { DEFAULT_CATEGORIES, categorise } from "./categories";
import type { CategoryDef } from "./categories";
import type { AccountTransaction } from "./types";

export type SplitBy = "total" | "category" | "account";

export interface SpendingSeries {
  key: string; // "total", a category key or an account id
  values: number[]; // euros spent each month, as positive amounts
}

export interface SpendingAnalysis {
  months: string[]; // YYYY-MM, the complete months in the range, oldest first
  series: SpendingSeries[]; // by total spent, largest first
}

export interface TrendStats {
  months: number;
  total: number;
  mean: number; // a month
  variance: number; // of the monthly amounts, in squared euros
  stdev: number;
  cv: number; // the standard deviation over the mean: the spread, relative to the amounts
  min: number;
  max: number;
  slope: number; // euros a month by which the trend rises (or falls, when negative) each month
  intercept: number; // the trend's value for the first month
  r2: number; // how much of the month-to-month changes the trend explains, 0 to 1
  yearly: number; // the trend over a year, relative to the average month
  residual: number; // the standard deviation of the months around the trend
}

/** The last day of a month (YYYY-MM), as YYYY-MM-DD. */
function monthEnd(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

/**
 * Spending a month from `range.from` to `range.to` as of `today`, over the months that are
 * complete in the range and over, for `accounts` (ids), the spending `picked` (category
 * keys), payees (payee keys) but those in `payeesOut`. Every account's transactions are categorised
 * together, for transfers to find their pair.
 */
export function spendingAnalysis(
  transactions: AccountTransaction[],
  options: {
    accounts: Set<string>;
    picked: Set<string>;
    payeesOut?: ReadonlySet<string> | null;
    range: { from: string; to: string };
    today: string;
    split: SplitBy;
    rules?: Record<string, string>;
    categories?: CategoryDef[];
  },
): SpendingAnalysis {
  const { accounts, picked, payeesOut, range, today, split, rules = {}, categories = DEFAULT_CATEGORIES } = options;
  const months: string[] = [];
  for (let month = range.from.slice(0, 7); month <= range.to.slice(0, 7) && months.length < 600; month = addMonths(month, 1)) {
    if (`${month}-01` >= range.from && monthEnd(month) <= range.to && monthEnd(month) < today) months.push(month);
  }
  const index = new Map(months.map((m, i) => [m, i]));
  const kinds = new Map(categories.map((c) => [c.key, c.kind]));
  const series = new Map<string, number[]>();

  const inRange = transactions.filter((tx) => index.has(tx.date.slice(0, 7)));
  for (const tx of categorise(inRange, rules, categories)) {
    if (!accounts.has(tx.account_id) || !picked.has(tx.key) || !passes(tx, { payeesOut })) continue;
    if ((kinds.get(tx.key) ?? "spending") !== "spending") continue;
    const value = amount(tx.amount);
    // Money in that nothing categorises counts as income, as in the budget; else a refund.
    if (value > 0 && tx.origin === "none") continue;
    const key = split === "total" ? "total" : split === "category" ? tx.key : tx.account_id;
    const values = series.get(key) ?? months.map(() => 0);
    values[index.get(tx.date.slice(0, 7))!]! -= value;
    series.set(key, values);
  }
  const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
  return {
    months,
    series: [...series]
      .map(([key, values]) => ({ key, values }))
      .sort((a, b) => sum(b.values) - sum(a.values)),
  };
}

/** A series' statistics; the trend is the least-squares line through the months. */
export function trendStats(values: number[]): TrendStats {
  const n = values.length;
  const total = values.reduce((sum, v) => sum + v, 0);
  const mean = n ? total / n : 0;
  const variance = n > 1 ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stdev = Math.sqrt(variance);
  const xMean = (n - 1) / 2;
  const sxx = values.reduce((sum, _, i) => sum + (i - xMean) ** 2, 0);
  const sxy = values.reduce((sum, v, i) => sum + (i - xMean) * (v - mean), 0);
  const slope = sxx ? sxy / sxx : 0;
  const intercept = mean - slope * xMean;
  const squares = values.reduce((sum, v, i) => sum + (v - (intercept + slope * i)) ** 2, 0);
  const spread = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return {
    months: n,
    total,
    mean,
    variance,
    stdev,
    cv: mean ? stdev / mean : 0,
    min: n ? Math.min(...values) : 0,
    max: n ? Math.max(...values) : 0,
    slope,
    intercept,
    r2: spread ? 1 - squares / spread : 0,
    yearly: mean ? (slope * 12) / mean : 0,
    residual: n > 2 ? Math.sqrt(squares / (n - 2)) : 0,
  };
}

/** The trend's value at month `i` (0 for the first month of the series), never below zero. */
export function trendAt(stats: TrendStats, i: number): number {
  return Math.max(stats.intercept + stats.slope * i, 0);
}

/** The trend over the `count` months after the series. */
export function projection(stats: TrendStats, count: number): number[] {
  return Array.from({ length: count }, (_, i) => trendAt(stats, stats.months + i));
}
