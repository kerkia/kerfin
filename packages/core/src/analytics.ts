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
