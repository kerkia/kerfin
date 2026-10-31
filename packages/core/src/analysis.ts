// Spending analysis: spending a month (or a week) for the accounts and categories picked, as a
// total or split by category or by account, and each series' statistics: average, spread, the
// trend a least-squares line gives, and where that trend leads. Spending is counted as in the
// budget: spending categories only, refunds lowering them. Only months (or weeks) that are
// over count, so one under way doesn't read as a drop.
import { amount } from "./analytics";
import { MAX_MONTHS, addMonths, monthEnd, monthsBetween, passes } from "./budget";
import { DEFAULT_CATEGORIES, categorise } from "./categories";
import type { CategoryDef } from "./categories";
import type { AccountTransaction } from "./types";

export type SplitBy = "total" | "category" | "account";
/** What a point of the analysis covers: a calendar month, or a week from Monday to Sunday. */
export type Step = "month" | "week";

export const PER_YEAR: Record<Step, number> = { month: 12, week: 52 };

/** `date` (YYYY-MM-DD) moved by `n` days. */
function addDays(date: string, n: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + n)).toISOString().slice(0, 10);
}

/** The Monday of `date`'s week (YYYY-MM-DD). */
export function weekOf(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return addDays(date.slice(0, 10), -((new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() + 6) % 7));
}

/** The point `n` points after `point`: a month (YYYY-MM) or a week (its Monday, YYYY-MM-DD). */
export function addPoints(point: string, step: Step, n: number): string {
  return step === "month" ? addMonths(point, n) : addDays(point, 7 * n);
}

/** The points from `from` to `to` (YYYY-MM-DD) that the range covers whole and that are over by `today`. */
export function pointsBetween(from: string, to: string, today: string, step: Step): string[] {
  if (step === "month") {
    return monthsBetween(from, to).filter((month) => `${month}-01` >= from && monthEnd(month) <= to && monthEnd(month) < today);
  }
  const weeks: string[] = [];
  // As many weeks as MAX_MONTHS go back, the latest kept.
  const first = weekOf(from) < from ? addDays(weekOf(from), 7) : weekOf(from);
  const earliest = addDays(weekOf(to), -7 * Math.ceil((MAX_MONTHS * 52) / 12));
  for (let monday = first > earliest ? first : earliest; addDays(monday, 6) <= to; monday = addDays(monday, 7)) {
    if (addDays(monday, 6) < today) weeks.push(monday);
  }
  return weeks;
}

export interface SpendingSeries {
  key: string; // "total", a category key or an account id
  values: number[]; // euros spent each month, as positive amounts
}

export interface SpendingAnalysis {
  points: string[]; // the complete months (YYYY-MM) or weeks (their Monday) in the range, oldest first
  series: SpendingSeries[]; // by total spent, largest first
}

export interface TrendStats {
  points: number;
  total: number;
  mean: number; // a month
  variance: number; // of the monthly amounts, in squared euros
  stdev: number;
  cv: number; // the standard deviation over the mean: the spread, relative to the amounts
  min: number;
  max: number;
  slope: number; // euros by which the trend rises (or falls, when negative) from a point to the next
  intercept: number; // the trend's value for the first point
  r2: number; // how much of the changes from point to point the trend explains, 0 to 1
  yearly: number; // the trend over a year, relative to the average point
  residual: number; // the standard deviation of the points around the trend
}

/**
 * Spending a month (or a week, by `step`) from `range.from` to `range.to` as of `today`, over
 * the points that are complete in the range and over, for `accounts` (ids), the spending
 * `picked` (category keys), payees (payee keys) but those in `payeesOut`. Every account's
 * transactions are categorised together, for transfers to find their pair.
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
    step?: Step;
    rules?: Record<string, string>;
    categories?: CategoryDef[];
  },
): SpendingAnalysis {
  const { accounts, picked, payeesOut, range, today, split, step = "month", rules = {}, categories = DEFAULT_CATEGORIES } = options;
  const points = pointsBetween(range.from, range.to, today, step);
  const index = new Map(points.map((point, i) => [point, i]));
  const pointOf = (date: string) => (step === "month" ? date.slice(0, 7) : weekOf(date));
  const kinds = new Map(categories.map((c) => [c.key, c.kind]));
  const series = new Map<string, number[]>();

  const inRange = transactions.filter((tx) => index.has(pointOf(tx.date)));
  for (const tx of categorise(inRange, rules, categories)) {
    if (!accounts.has(tx.account_id) || !picked.has(tx.key) || !passes(tx, { payeesOut })) continue;
    if ((kinds.get(tx.key) ?? "spending") !== "spending") continue;
    const value = amount(tx.amount);
    // Money in that nothing categorises counts as income, as in the budget; else a refund.
    if (value > 0 && tx.origin === "none") continue;
    const key = split === "total" ? "total" : split === "category" ? tx.key : tx.account_id;
    const values = series.get(key) ?? points.map(() => 0);
    values[index.get(pointOf(tx.date))!]! -= value;
    series.set(key, values);
  }
  const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
  return {
    points,
    series: [...series]
      .map(([key, values]) => ({ key, values }))
      .sort((a, b) => sum(b.values) - sum(a.values)),
  };
}

/** A series' statistics, for `perYear` points a year; the trend is the least-squares line through the points. */
export function trendStats(values: number[], perYear = 12): TrendStats {
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
    points: n,
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
    yearly: mean ? (slope * perYear) / mean : 0,
    residual: n > 2 ? Math.sqrt(squares / (n - 2)) : 0,
  };
}

/** The trend's value at point `i` (0 for the first point of the series), never below zero. */
export function trendAt(stats: TrendStats, i: number): number {
  return Math.max(stats.intercept + stats.slope * i, 0);
}

/** The trend over the `count` points after the series. */
export function projection(stats: TrendStats, count: number): number[] {
  return Array.from({ length: count }, (_, i) => trendAt(stats, stats.points + i));
}
