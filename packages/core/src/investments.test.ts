import { describe, expect, it } from "vitest";

import {
  assetClass,
  assetClasses,
  breakdown,
  composition,
  holdingsHistory,
  indexOf,
  PRECIOUS_MINING,
  pricedHoldings,
  returns,
  themeOf,
  themes,
} from "./investments";
import type { IndexProfile, Market, MarketHolding, SecurityInfo } from "./investments";

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

describe("themes", () => {
  const cases: [string, string, string | null][] = [
    ["NYSE Arca Gold BUGS Index Fund", "equities", "miners"],
    ["VanEck Gold Miners UCITS ETF", "equities", "miners"],
    ["iShares Physical Gold ETC", "commodities", "precious_metals"],
    ["WisdomTree Brent Crude Oil", "commodities", "energy"],
    ["iShares MSCI World Energy Sector UCITS ETF", "equities", "energy"],
    ["VanEck Rare Earth and Strategic Metals UCITS ETF", "equities", "rare_earths"],
    ["Global X Uranium UCITS ETF", "equities", "uranium"],
    ["WisdomTree Enhanced Commodity ex-Agriculture UCITS ETF", "commodities", "broad_commodities"],
    ["iShares Global Clean Energy UCITS ETF", "equities", "clean_energy"],
    ["Amundi MSCI World UCITS ETF", "equities", null],
  ];
  it.each(cases)("%s is %s, theme %s", (name, kind, theme) => {
    const h = holding(name, "1");
    expect(assetClass(h)).toBe(kind);
    expect(themeOf(h)).toBe(theme);
  });

  // What ESMA's register (CFI code) and the price source say, as for real securities of each kind.
  const security = (isin: string, cfi: string, extra: Partial<SecurityInfo> = {}): SecurityInfo => ({
    isin,
    symbol: null,
    currency: null,
    quote_type: null,
    sector: null,
    country: null,
    cfi,
    ...extra,
  });
  const listed: [string, SecurityInfo, string, string | null][] = [
    // UCITS funds can't own metal: a gold fund owns miners, whatever its name.
    ["Gold Opportunities Fund", security("X1", "CIOGMS"), "equities", "miners"],
    ["Precious Metals Fund R", security("X2", "CIXXXX"), "equities", "miners"],
    ["Gold Producers UCITS ETF", security("X3", "CEOGES"), "equities", "miners"],
    // Notes and certificates on gold are the metal.
    ["Physical Gold ETC", security("X4", "EYAYFT"), "commodities", "precious_metals"],
    ["Gold Securities", security("X5", "DAZSPR"), "commodities", "precious_metals"],
    ["Brent Crude Oil", security("X6", "DAZSPR"), "commodities", "energy"],
    // A closed-end trust holding silver bars, quoted like a company.
    ["Physical Silver Trust", security("X7", "CICXXX", { quote_type: "EQUITY", sector: "Financial Services" }), "commodities", "precious_metals"],
    // A UCITS ETF holding commodities through swaps.
    ["Diversified Commodity Swap UCITS ETF", security("X8", "CEOGCS"), "commodities", "broad_commodities"],
    // Company shares: their industry gives the theme.
    ["Big Oil Corp", security("X9", "ESVUFR", { quote_type: "EQUITY", sector: "Energy", industry: "Oil & Gas Integrated" }), "equities", "energy"],
    ["Gold Mining Co", security("X10", "ESVUFR", { quote_type: "EQUITY", sector: "Basic Materials", industry: "Gold" }), "equities", "miners"],
    ["Logistics REIT", security("X11", "CBOIXU", { quote_type: "EQUITY", sector: "Real Estate", industry: "REIT—Industrial" }), "equities", null],
  ];
  it.each(listed)("%s is %s, theme %s", (name, info, kind, theme) => {
    const h = holding(name, "1", info.isin);
    expect(assetClass(h, info)).toBe(kind);
    expect(themeOf(h, info)).toBe(theme);
  });

  it("leaves commodities out of the sector and country split", () => {
    const m = market({
      holdings: [holding("Physical Silver Trust", "100", "X7"), holding("Logistics REIT", "50", "X11")],
      securities: {
        X7: security("X7", "CICXXX", { quote_type: "EQUITY", sector: "Financial Services" }),
        X11: security("X11", "CBOIXU", { quote_type: "EQUITY", sector: "Real Estate" }),
      },
      prices: {},
    });
    expect(breakdown(m, "sectors")).toEqual({ slices: [{ key: "Real Estate", value: 50 }], covered: 50, total: 50 });
  });

  it("places a company in its ISIN's country when its own isn't known", () => {
    const m = market({
      holdings: [holding("Some Bank", "10", "SG0000000001")],
      securities: { SG0000000001: security("SG0000000001", "ESVUFR", { quote_type: "EQUITY" }) },
      prices: {},
    });
    expect(composition(m, m.holdings[0]!, "countries")).toEqual({ Singapore: 1 });
  });

  it("puts a world sector fund in its sector, with the sector index's countries", () => {
    const healthCare: IndexProfile = {
      ...WORLD,
      id: "msci-world-health-care",
      name: "MSCI World Health Care",
      match: "(?!)",
      sector: "Health Care",
      countries: { "United States": 70, Switzerland: 30 },
      sectors: { "Health Care": 100 },
    };
    const m = market({
      holdings: [holding("MSCI World Health Care UCITS ETF", "100", "X12")],
      securities: { X12: security("X12", "CECGMS", { quote_type: "ETF" }) },
      prices: {},
      indices: [WORLD, healthCare],
    });
    const fund = m.holdings[0]!;
    expect(composition(m, fund, "sectors")).toEqual({ "Health Care": 1 });
    expect(composition(m, fund, "countries")).toEqual({ "United States": 0.7, Switzerland: 0.3 });
    expect(indexOf(fund, m.indices, m.securities.X12)?.id).toBe("msci-world-health-care");
    // The broad world fund still follows MSCI World.
    expect(indexOf(holding("Core MSCI World", "1"), m.indices, security("X13", "CEOGES"))?.id).toBe("msci-world");
  });

  it("puts precious metals miners in their own sector and leaves their countries unknown", () => {
    const m = market({ holdings: [holding("Junior Gold Miners UCITS ETF", "100")], securities: {}, prices: {} });
    expect(composition(m, m.holdings[0]!, "sectors")).toEqual({ [PRECIOUS_MINING]: 1 });
    expect(composition(m, m.holdings[0]!, "countries")).toBeNull();
    expect(themes(m)).toEqual({ slices: [{ key: "miners", value: 100 }], total: 100 });
  });

  it("puts a gold mining company in precious metals mining, other miners in Materials", () => {
    const m = market({
      holdings: [holding("Gold Mining Co", "10", "X10"), holding("Copper Co", "10", "X14")],
      securities: {
        X10: security("X10", "ESVUFR", { quote_type: "EQUITY", sector: "Basic Materials", industry: "Gold" }),
        X14: security("X14", "ESVUFR", { quote_type: "EQUITY", sector: "Basic Materials", industry: "Copper" }),
      },
      prices: {},
    });
    expect(composition(m, m.holdings[0]!, "sectors")).toEqual({ [PRECIOUS_MINING]: 1 });
    expect(composition(m, m.holdings[1]!, "sectors")).toEqual({ Materials: 1 });
  });

  it("splits a materials fund as its sector index does", () => {
    const materials: IndexProfile = {
      ...WORLD,
      id: "msci-world-materials",
      match: "(?!)",
      sector: "Materials",
      sectors: { Materials: 80, [PRECIOUS_MINING]: 20 },
    };
    const m = market({ holdings: [holding("MSCI World Materials UCITS ETF", "100")], securities: {}, prices: {}, indices: [WORLD, materials] });
    expect(composition(m, m.holdings[0]!, "sectors")).toEqual({ Materials: 0.8, [PRECIOUS_MINING]: 0.2 });
  });
});
