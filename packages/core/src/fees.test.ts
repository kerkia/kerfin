import { describe, expect, it } from "vitest";

import { contractRate, feeCost, feeSummary } from "./fees";
import type { Market, MarketHolding } from "./investments";
import type { Account, AccountKind } from "./types";

function account(id: string, kind: AccountKind, extra: Partial<Account> = {}): Account {
  return {
    id,
    connection_id: "c1",
    institution: "finary",
    institution_name: null,
    label: id,
    kind,
    kind_detected: kind,
    kind_set: false,
    insurer: null,
    insurer_suggested: null,
    fee_rate: null,
    subtype: null,
    number: null,
    currency: "EUR",
    balance: "0",
    opening_date: null,
    updated_at: "2026-01-01T00:00:00+00:00",
    hidden: false,
    ...extra,
  };
}

function holding(account_id: string, label: string, valuation: string, fees: string | null, isin: string | null = null): MarketHolding {
  return {
    account_id,
    label,
    isin,
    valuation,
    currency: "EUR",
    unit_value: null,
    unit_value_currency: null,
    security_type: null,
    fees,
    match: null,
  };
}

const SUGGESTED = { contract: "Some Contract", uc: "0.005", euro: "0.006", source: "https://example.com" };

function market(holdings: MarketHolding[]): Market {
  return {
    holdings,
    securities: { US0000000001: { isin: "US0000000001", symbol: "X", currency: "USD", quote_type: "EQUITY", sector: null, country: null } },
    prices: {},
    fx: {},
    indices: [],
  };
}

describe("fees", () => {
  it("adds funds' charges and the contract's fees, by holding and by account", () => {
    const accounts = [account("av", "life_insurance", { fees_suggested: SUGGESTED }), account("cto", "securities")];
    const m = market([
      holding("av", "World Index Fund", "10000", "0.002"),
      holding("av", "Fonds euros", "5000", null),
      holding("cto", "Some Company", "2000", null, "US0000000001"),
      holding("cto", "Mystery Fund", "1000", null),
    ]);
    const summary = feeSummary(m, accounts);
    // Fund: 10000 × (0.2% + 0.5%) = 70; euro fund: 5000 × 0.6% = 30; shares: nothing.
    expect(summary.fundFees).toBeCloseTo(20);
    expect(summary.contractFees).toBeCloseTo(80);
    expect(summary.lines.map((l) => [l.holding.label, Math.round(l.yearly)])).toEqual([
      ["World Index Fund", 70],
      ["Fonds euros", 30],
      ["Some Company", 0],
      ["Mystery Fund", 0],
    ]);
    expect(summary.fundUnknown).toBe(1000);
    expect(summary.accounts.map((a) => a.account.id)).toEqual(["av", "cto"]);
    expect(summary.accounts[0]!.euroFund).toBe(5000);
    expect(summary.insured).toBe(15000);
    expect(summary.contractsUnknown).toEqual([]);
  });

  it("prefers the user's rate, and lists contracts whose fees aren't known", () => {
    const set = account("per", "retirement", { fee_rate: "0.007", fees_suggested: SUGGESTED });
    expect(contractRate(set, true)).toEqual({ rate: 0.007, source: "user" });
    expect(contractRate(account("cto", "securities", { fee_rate: "0.01" }), false)).toBeNull();
    const unknown = account("av", "life_insurance", { balance: "3000" });
    const summary = feeSummary(market([]), [unknown]);
    expect(summary.contractsUnknown.map((a) => a.id)).toEqual(["av"]);
    expect(summary.value).toBe(3000);
  });

  it("leaves hidden accounts out", () => {
    const summary = feeSummary(market([holding("h", "Fund", "100", "0.01")]), [account("h", "pea", { hidden: true })]);
    expect(summary.lines).toEqual([]);
  });

  it("costs what the value would have grown without fees", () => {
    // 1% a year over 10 years at 5% growth: 10000 × (1.05^10 − (1.05 × 0.99)^10).
    expect(feeCost(10000, 0.01, 0.05, 10)).toBeCloseTo(10000 * (1.05 ** 10 - (1.05 * 0.99) ** 10));
    expect(feeCost(10000, 0, 0.05, 10)).toBe(0);
  });
});
