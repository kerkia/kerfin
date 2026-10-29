import { describe, expect, it } from "vitest";

import { incomeCalendar, incomeLines } from "./income";
import type { Market, MarketHolding } from "./investments";

function holding(label: string, valuation: string, isin: string | null, annual_yield: string | null = null): MarketHolding {
  return {
    account_id: "a",
    label,
    isin,
    valuation,
    currency: "EUR",
    unit_value: null,
    unit_value_currency: null,
    security_type: null,
    fees: null,
    match: null,
    annual_yield,
  };
}

const TODAY = "2026-10-29";

function market(): Market {
  return {
    holdings: [
      holding("Dividend Fund", "1100", "D"),
      holding("Accumulating Fund", "500", "A"),
      holding("Fonds euros", "2000", null, "0.025"),
      holding("Unknown Fund", "300", null),
    ],
    securities: {
      D: { isin: "D", symbol: "D", currency: "EUR", quote_type: "ETF", sector: null, country: null },
      A: { isin: "A", symbol: "A", currency: "EUR", quote_type: "ETF", sector: null, country: null },
    },
    prices: {
      D: [["2026-10-28", "110"]], // 1100 EUR = 10 units
      A: [["2026-10-28", "50"]],
    },
    fx: {},
    indices: [],
    dividends: {
      D: [
        ["2025-06-15", "9"], // more than a year ago: not counted
        ["2025-12-10", "1"],
        ["2026-06-10", "2"],
      ],
    },
  };
}

describe("passive income", () => {
  it("counts last year's distributions for today's units, else Finary's stated yield", () => {
    const lines = incomeLines(market(), TODAY);
    expect(lines.map((l) => [l.holding.label, l.source, Math.round(l.yearly)])).toEqual([
      ["Fonds euros", "stated", 50],
      ["Dividend Fund", "distributions", 30], // (1 + 2) × 10 units
      ["Accumulating Fund", "reinvested", 0],
    ]);
    expect(lines[1]!.yield).toBeCloseTo(30 / 1100);
  });

  it("projects the next twelve months from last year's payment months", () => {
    const calendar = incomeCalendar(incomeLines(market(), TODAY), TODAY);
    expect(calendar.map((m) => m.month)).toEqual([
      "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
      "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09",
    ]);
    expect(calendar.find((m) => m.month === "2026-12")!.value).toBeCloseTo(10);
    expect(calendar.find((m) => m.month === "2027-06")!.value).toBeCloseTo(20);
    expect(calendar.reduce((sum, m) => sum + m.value, 0)).toBeCloseTo(30);
  });
});
