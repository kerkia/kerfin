import type { Account, AccountKind, BalancePoint } from "./types";

export const BASE_CURRENCY = "EUR";

// Card balances are deferred debits already counted in the checking account.
const EXCLUDED_KINDS: ReadonlySet<AccountKind> = new Set(["card"]);

export function amount(value: string | null | undefined): number {
  const parsed = value == null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Accounts that count towards net worth: visible, not cards, with a balance. */
export function countedAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => !a.hidden && !EXCLUDED_KINDS.has(a.kind) && a.balance != null);
}

function inBase(account: Account): boolean {
  return (account.currency ?? BASE_CURRENCY) === BASE_CURRENCY;
}

export interface NetWorth {
  total: number; // in BASE_CURRENCY
  assets: number;
  liabilities: number; // negative or zero
  // Balances in other currencies, not converted yet.
  otherCurrencies: { currency: string; total: number }[];
}

export function netWorth(accounts: Account[]): NetWorth {
  let assets = 0;
  let liabilities = 0;
  const others = new Map<string, number>();
  for (const account of countedAccounts(accounts)) {
    const value = amount(account.balance);
    if (!inBase(account)) {
      others.set(account.currency!, (others.get(account.currency!) ?? 0) + value);
    } else if (value < 0) {
      liabilities += value;
    } else {
      assets += value;
    }
  }
  return {
    total: assets + liabilities,
    assets,
    liabilities,
    otherCurrencies: [...others].map(([currency, total]) => ({ currency, total })),
  };
}

export interface Slice<K extends string = string> {
  key: K;
  value: number;
  share: number; // of the total of positive slices, 0..1
}

function slices<K extends string>(totals: Map<K, number>): Slice<K>[] {
  const positive = [...totals].filter(([, value]) => value > 0);
  const sum = positive.reduce((s, [, value]) => s + value, 0);
  return positive
    .map(([key, value]) => ({ key, value, share: sum ? value / sum : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** Assets by account kind (savings, life insurance...), largest first. */
export function allocationByKind(accounts: Account[]): Slice<AccountKind>[] {
  const totals = new Map<AccountKind, number>();
  for (const account of countedAccounts(accounts).filter(inBase)) {
    totals.set(account.kind, (totals.get(account.kind) ?? 0) + amount(account.balance));
  }
  return slices(totals);
}

/** Assets by institution, keyed by the display name `nameOf` gives each account. */
export function allocationByInstitution(accounts: Account[], nameOf: (a: Account) => string): Slice[] {
  const totals = new Map<string, number>();
  for (const account of countedAccounts(accounts).filter(inBase)) {
    const name = nameOf(account);
    totals.set(name, (totals.get(name) ?? 0) + amount(account.balance));
  }
  return slices(totals);
}

export interface HistoryPoint {
  date: string;
  value: number;
}

/**
 * Net worth on each day a balance was recorded. Each account contributes its latest
 * known balance as of that day, so accounts synced on different days still add up.
 */
export function netWorthHistory(history: BalancePoint[], accounts: Account[]): HistoryPoint[] {
  const counted = new Set(countedAccounts(accounts).filter(inBase).map((a) => a.id));
  const points = history.filter((p) => counted.has(p.account_id)).sort((a, b) => a.date.localeCompare(b.date));
  const latest = new Map<string, number>();
  const series: HistoryPoint[] = [];
  for (const point of points) {
    latest.set(point.account_id, amount(point.balance));
    const value = [...latest.values()].reduce((s, v) => s + v, 0);
    const last = series[series.length - 1];
    if (last?.date === point.date) last.value = value;
    else series.push({ date: point.date, value });
  }
  return series;
}

/** Change between the last point and the latest point at least `days` before it. */
export function changeOver(series: HistoryPoint[], days: number): { absolute: number; relative: number } | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const cutoff = new Date(last.date);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffText = cutoff.toISOString().slice(0, 10);
  const reference = [...series].reverse().find((p) => p.date <= cutoffText);
  if (!reference) return null;
  const absolute = last.value - reference.value;
  return { absolute, relative: reference.value ? absolute / Math.abs(reference.value) : 0 };
}

/** Periods the overview can show, as on most portfolio apps. */
export const RANGES = ["1D", "7D", "1M", "3M", "6M", "YTD", "1Y", "ALL"] as const;
export type Range = (typeof RANGES)[number];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First day of `range` ending on `today` (YYYY-MM-DD), or null for all history. */
export function rangeStart(range: Range, today: string): string | null {
  const date = new Date(`${today}T00:00:00Z`);
  switch (range) {
    case "1D":
      date.setUTCDate(date.getUTCDate() - 1);
      break;
    case "7D":
      date.setUTCDate(date.getUTCDate() - 7);
      break;
    case "1M":
      date.setUTCMonth(date.getUTCMonth() - 1);
      break;
    case "3M":
      date.setUTCMonth(date.getUTCMonth() - 3);
      break;
    case "6M":
      date.setUTCMonth(date.getUTCMonth() - 6);
      break;
    case "YTD":
      return `${today.slice(0, 4)}-01-01`;
    case "1Y":
      date.setUTCFullYear(date.getUTCFullYear() - 1);
      break;
    case "ALL":
      return null;
  }
  return isoDate(date);
}

/** One account's recorded balances, oldest first. */
export function accountHistory(history: BalancePoint[], accountId: string): HistoryPoint[] {
  return history
    .filter((p) => p.account_id === accountId)
    .map((p) => ({ date: p.date, value: amount(p.balance) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The part of `series` a range shows: from the last point on or before `start`, so the
 * line starts at the range's opening value. */
export function seriesSince(series: HistoryPoint[], start: string | null): HistoryPoint[] {
  if (start === null) return series;
  const opening = series.filter((p) => p.date <= start).pop();
  return [...(opening ? [opening] : []), ...series.filter((p) => p.date > start)];
}

export interface Change {
  absolute: number;
  relative: number | null; // null when the opening value is zero
  from: string; // date of the opening value
  partial: boolean; // the history doesn't reach back to the range's start
}

/** Change from the opening value of the range to the latest value. */
export function changeSince(series: HistoryPoint[], start: string | null): Change | null {
  const shown = seriesSince(series, start);
  const first = shown[0];
  const last = shown[shown.length - 1];
  if (!first || !last || first === last) return null;
  const absolute = last.value - first.value;
  return {
    absolute,
    relative: first.value ? absolute / Math.abs(first.value) : null,
    from: first.date,
    partial: start !== null && first.date > start,
  };
}

/**
 * How the counted accounts changed over the range: the sum of each account's change from
 * its opening value. An account added during the range has no opening value, so it adds
 * nothing (new money isn't a gain).
 */
export function portfolioChange(history: BalancePoint[], accounts: Account[], start: string | null): Change | null {
  const changes = countedAccounts(accounts)
    .filter(inBase)
    .map((account) => ({ account, change: changeSince(accountHistory(history, account.id), start) }))
    .filter((c): c is { account: Account; change: Change } => c.change !== null);
  if (changes.length === 0) return null;
  const absolute = changes.reduce((sum, c) => sum + c.change.absolute, 0);
  const opening = changes.reduce((sum, c) => sum + amount(c.account.balance) - c.change.absolute, 0);
  return {
    absolute,
    relative: opening ? absolute / Math.abs(opening) : null,
    from: changes.map((c) => c.change.from).sort()[0]!,
    partial: changes.some((c) => c.change.partial),
  };
}
