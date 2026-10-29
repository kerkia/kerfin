// Passive income: the distributions (dividends, coupons of distributing funds) today's
// holdings paid over the last year, projected over the next, and the interest Finary
// states for lines without market data (euro funds...).
import { amount } from "./analytics";
import { convert } from "./investments";
import type { Market, MarketHolding } from "./investments";

export interface Payment {
  date: string; // ex-date, YYYY-MM-DD
  value: number; // euros, for today's units
}

export interface IncomeLine {
  holding: MarketHolding;
  value: number; // euros
  // "distributions": paid in the last year (market data); "stated": the yield Finary gives;
  // "reinvested": priced, but paid nothing in two years (accumulating, or no dividend).
  source: "distributions" | "stated" | "reinvested";
  yearly: number; // euros over a year, at today's units
  yield: number; // yearly / value
  payments: Payment[]; // the last year's, oldest first
}

/** The day `years` years before `date` (YYYY-MM-DD). */
function yearsBefore(date: string, years: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCFullYear(day.getUTCFullYear() - years);
  return day.toISOString().slice(0, 10);
}

/**
 * Each holding's income over a year, as of `today` (YYYY-MM-DD): what its distributions of
 * the last year come to for the units held today, or else the yield Finary states for it.
 * Holdings with neither are left out.
 */
export function incomeLines(market: Market, today: string): IncomeLine[] {
  const yearAgo = yearsBefore(today, 1);
  const lines: IncomeLine[] = [];
  for (const holding of market.holdings) {
    const value = amount(holding.valuation);
    if (value <= 0) continue;
    const security = holding.isin ? market.securities[holding.isin] : undefined;
    const prices = holding.isin ? market.prices[holding.isin] : undefined;
    const latest = prices?.length ? prices[prices.length - 1]! : undefined;
    if (security?.symbol && security.currency && latest) {
      // Units held today: today's value over today's price, in the security's currency.
      const local = convert(market, value, holding.currency ?? "EUR", security.currency, latest[0]);
      const units = local === null || !amount(latest[1]) ? 0 : local / amount(latest[1]);
      const payments: Payment[] = [];
      for (const [date, perUnit] of market.dividends?.[holding.isin!] ?? []) {
        if (date <= yearAgo || date > today) continue;
        const paid = convert(market, units * amount(perUnit), security.currency, "EUR", date);
        if (paid !== null) payments.push({ date, value: paid });
      }
      const yearly = payments.reduce((sum, p) => sum + p.value, 0);
      lines.push({ holding, value, source: yearly > 0 ? "distributions" : "reinvested", yearly, yield: yearly / value, payments });
      continue;
    }
    const stated = holding.annual_yield ? amount(holding.annual_yield) : 0;
    if (stated > 0) lines.push({ holding, value, source: "stated", yearly: value * stated, yield: stated, payments: [] });
  }
  return lines.sort((a, b) => b.yearly - a.yearly);
}

/**
 * The next twelve months' distributions, by calendar month starting with `today`'s: each of
 * the last year's payments expected again a year later. Stated yields (credited once a year,
 * at dates not known) aren't included.
 */
export function incomeCalendar(lines: IncomeLine[], today: string): { month: string; value: number }[] {
  const first = Number(today.slice(5, 7)) - 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(Number(today.slice(0, 4)), first + i, 1));
    return { month: date.toISOString().slice(0, 7), value: 0 };
  });
  for (const line of lines) {
    for (const payment of line.payments) {
      // A year on, in the same calendar month (12 months from today's month cover it).
      const month = Number(payment.date.slice(5, 7)) - 1;
      months[(month - first + 12) % 12]!.value += payment.value;
    }
  }
  return months;
}
