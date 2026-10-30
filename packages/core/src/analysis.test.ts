import { describe, expect, it } from "vitest";

import { projection, spendingAnalysis, trendAt, trendStats } from "./analysis";
import type { AccountTransaction } from "./types";

function tx(account_id: string, date: string, label: string, amount: string, category: string | null = null): AccountTransaction {
  return { account_id, date, label, amount, currency: "EUR", pending: false, category, payee: null };
}

// Made-up transactions.
const TRANSACTIONS = [
  tx("current", "2026-08-03", "Rent", "-900", "Logement"),
  tx("current", "2026-08-10", "Some Shop", "-100", "Alimentation"),
  tx("current", "2026-08-28", "Salary", "3000", "Salaires"),
  tx("current", "2026-09-03", "Rent", "-900", "Logement"),
  tx("current", "2026-09-10", "Some Shop", "-150", "Alimentation"),
  tx("current", "2026-09-12", "Some Shop refund", "20", "Alimentation"),
  tx("card", "2026-09-20", "Some Shop", "-30", "Alimentation"),
  tx("current", "2026-09-25", "Card bill", "-30"),
  tx("other", "2026-09-25", "Card bill", "30"),
  tx("current", "2026-10-03", "Rent", "-900", "Logement"), // the month under way: left out
];

describe("spendingAnalysis", () => {
  const options = {
    accounts: new Set(["current", "card"]),
    picked: new Set(["housing", "groceries", "transfers", "income"]),
    range: { from: "2026-08-01", to: "2026-10-29" },
    today: "2026-10-29",
  };

  it("adds the complete months' spending, refunds lowering it, transfers and income aside", () => {
    const result = spendingAnalysis(TRANSACTIONS, { ...options, split: "total" });
    expect(result.months).toEqual(["2026-08", "2026-09"]);
    expect(result.series).toEqual([{ key: "total", values: [1000, 1060] }]);
  });

  it("splits by category and by account, largest first", () => {
    expect(spendingAnalysis(TRANSACTIONS, { ...options, split: "category" }).series).toEqual([
      { key: "housing", values: [900, 900] },
      { key: "groceries", values: [100, 160] },
    ]);
    expect(spendingAnalysis(TRANSACTIONS, { ...options, split: "account" }).series).toEqual([
      { key: "current", values: [1000, 1030] },
      { key: "card", values: [0, 30] },
    ]);
  });

  it("keeps the accounts and categories picked only", () => {
    const result = spendingAnalysis(TRANSACTIONS, {
      ...options,
      accounts: new Set(["current"]),
      picked: new Set(["groceries"]),
      split: "total",
    });
    expect(result.series).toEqual([{ key: "total", values: [100, 130] }]);
  });

  it("leaves out a month the range covers only in part", () => {
    const result = spendingAnalysis(TRANSACTIONS, { ...options, range: { from: "2026-08-15", to: "2026-10-29" }, split: "total" });
    expect(result.months).toEqual(["2026-09"]);
  });
});

describe("trendStats", () => {
  it("gives the average, spread and least-squares trend", () => {
    const stats = trendStats([100, 120, 110, 150]);
    expect(stats.total).toBe(480);
    expect(stats.mean).toBe(120);
    expect(stats.variance).toBeCloseTo(466.667, 3); // sample variance
    expect(stats.stdev).toBeCloseTo(21.602, 3);
    expect(stats.cv).toBeCloseTo(0.18, 3);
    expect([stats.min, stats.max]).toEqual([100, 150]);
    expect(stats.slope).toBeCloseTo(14, 6);
    expect(stats.intercept).toBeCloseTo(99, 6);
    expect(stats.r2).toBeCloseTo(0.7, 6);
    expect(stats.yearly).toBeCloseTo(1.4, 6);
    expect(stats.residual).toBeCloseTo(Math.sqrt(420 / 2), 6);
  });

  it("projects the trend, never below zero", () => {
    const stats = trendStats([300, 200, 100]);
    expect(projection(stats, 4)).toEqual([0, 0, 0, 0]);
    expect(trendAt(stats, 1)).toBeCloseTo(200, 6);
    expect(projection(trendStats([100, 120, 110, 150]), 2).map((v) => Math.round(v))).toEqual([155, 169]);
  });

  it("is flat and spreadless for a single month or none", () => {
    expect(trendStats([80])).toMatchObject({ mean: 80, stdev: 0, slope: 0, r2: 0, yearly: 0 });
    expect(trendStats([])).toMatchObject({ total: 0, mean: 0, min: 0, max: 0 });
  });
});
