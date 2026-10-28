import { describe, expect, it } from "vitest";

import {
  assetClass,
  assetClasses,
  breakdown,
  composition,
  holdingsHistory,
  indexOf,
  pricedHoldings,
  returns,
} from "./investments";
import type { IndexProfile, Market, MarketHolding } from "./investments";

function holding(label: string, valuation: string, isin: string | null = null, extra: Partial<MarketHolding> = {}): MarketHolding {
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
    ...extra,
  };
}

const WORLD: IndexProfile = {
  id: "msci-world",
  name: "MSCI World",
  source: "",
  as_of: "SEP 30, 2026",
  match: "msci world|\\bworld\\b",
  approximate: false,
  countries: { "United States": 75, Japan: 5, Other: 20 },
  sectors: { "Information Technology": 30, Financials: 70 },
};

function market(extra: Partial<Market> = {}): Market {
  return {
    holdings: [
      holding("iShares Core MSCI World", "1000", "IE00B4L5Y983"),
      holding("Apple", "500", "US0378331005"),
      holding("Fonds Euros Nouvelle Génération", "2000"),
      holding("Carmignac Patrimoine", "500", "FR0010135103"),
    ],
    securities: {
      IE00B4L5Y983: { isin: "IE00B4L5Y983", symbol: "IWDA.L", currency: "USD", quote_type: "ETF", sector: null, country: null },
      US0378331005: { isin: "US0378331005", symbol: "AAPL", currency: "USD", quote_type: "EQUITY", sector: "Technology", country: "United States" },
    },
    prices: {
      IE00B4L5Y983: [
        ["2025-10-28", "100"],
        ["2026-10-28", "110"],
      ],
    },
    fx: {
      USD: [
        ["2025-10-28", "1.00"],
        ["2026-10-28", "1.10"],
      ],
    },
    indices: [WORLD],
    ...extra,
  };
}

describe("composition", () => {
  it("classifies holdings by name, type and source", () => {
    const m = market();
    expect(assetClass(m.holdings[0]!, m.securities.IE00B4L5Y983)).toBe("equities");
    expect(assetClass(m.holdings[1]!, m.securities.US0378331005)).toBe("equities");
    expect(assetClass(m.holdings[2]!)).toBe("euro_fund");
    expect(assetClass(m.holdings[3]!)).toBe("mixed");
    expect(assetClass(holding("SCPI Primovie", "1"))).toBe("real_estate");
    expect(assetClasses(m)[0]).toEqual({ key: "euro_fund", value: 2000 });
  });

  it("matches index funds, not company shares or other funds", () => {
    const m = market();
    expect(indexOf(m.holdings[0]!, m.indices, m.securities.IE00B4L5Y983)?.id).toBe("msci-world");
    expect(indexOf(m.holdings[1]!, m.indices, m.securities.US0378331005)).toBeNull();
    expect(indexOf(m.holdings[3]!, m.indices)).toBeNull();
  });

  it("splits by country through index weights and company shares, and reports coverage", () => {
    const countries = breakdown(market(), "countries");
    expect(countries.slices).toEqual([
      { key: "United States", value: 1250 },
      { key: "Other", value: 200 },
      { key: "Japan", value: 50 },
    ]);
    expect(countries.covered).toBe(1500);
    expect(countries.total).toBe(4000);
    const sectors = breakdown(market(), "sectors");
    // 30% of the fund (300) plus Apple (500).
    expect(sectors.slices[0]).toEqual({ key: "Information Technology", value: 800 });
    expect(sectors.slices[1]).toEqual({ key: "Financials", value: 700 });
  });
});

describe("performance", () => {
  it("prices today's holdings over time, in any currency", () => {
    // 1000 EUR today = 1100 USD = 10 units at 110 USD. A year ago: 10 × 100 USD = 1000 USD = 1000 EUR.
    const inEuros = holdingsHistory(market(), "EUR", null);
    expect(inEuros.map((p) => [p.date, Math.round(p.value)])).toEqual([
      ["2025-10-28", 1000],
      ["2026-10-28", 1000],
    ]);
    const inDollars = holdingsHistory(market(), "USD", null);
    expect(inDollars.map((p) => Math.round(p.value))).toEqual([1000, 1100]);
  });

  it("counts a holding with a shorter history by its moves, not its value", () => {
    const m = market({
      holdings: [holding("A", "100", "A"), holding("B", "100", "B")],
      securities: {
        A: { isin: "A", symbol: "A", currency: "EUR", quote_type: "ETF", sector: null, country: null },
        B: { isin: "B", symbol: "B", currency: "EUR", quote_type: "ETF", sector: null, country: null },
      },
      prices: {
        A: [
          ["2026-01-01", "10"],
          ["2026-02-01", "10"],
          ["2026-03-01", "10"],
        ],
        // B starts in February and doubles by March.
        B: [
          ["2026-02-01", "5"],
          ["2026-03-01", "10"],
        ],
      },
    });
    // Jan -> Feb: only A, flat. Feb -> Mar: A flat, B doubles: 100 + 50 -> 100 + 100.
    const values = holdingsHistory(m, "EUR", null).map((p) => Math.round(p.value));
    expect(values).toEqual([150, 150, 200]);
  });

  it("leaves holdings without prices out, and says how much", () => {
    const { priced, unpricedValue } = pricedHoldings(market());
    expect(priced.map((p) => p.holding.isin)).toEqual(["IE00B4L5Y983"]);
    expect(unpricedValue).toBe(3000);
  });

  it("computes returns in the chosen currency", () => {
    const m = market();
    const [world] = pricedHoldings(m).priced;
    expect(returns(m, world!, "USD", null).oneYear).toBeCloseTo(0.1);
    expect(returns(m, world!, "EUR", null).oneYear).toBeCloseTo(0);
    expect(returns(m, world!, "EUR", null).threeYears).toBeNull();
  });
});

describe("exposure of one holding", () => {
  it("is the index weights for an index fund, all of it for a company share", () => {
    const m = market();
    expect(composition(m, m.holdings[0]!, "countries")).toEqual({ "United States": 0.75, Japan: 0.05, Other: 0.2 });
    expect(composition(m, m.holdings[1]!, "sectors")).toEqual({ "Information Technology": 1 });
    expect(composition(m, m.holdings[2]!, "countries")).toBeNull();
  });
});
