import { describe, expect, it } from "vitest";

import { UNCATEGORISED, budget } from "./budget";
import type { AccountTransaction } from "./types";

function tx(account_id: string, date: string, label: string, amount: string, category: string | null = null): AccountTransaction {
  return { account_id, date, label, amount, currency: "EUR", pending: false, category };
}

const TRANSACTIONS = [
  tx("current", "2026-10-03", "Rent", "-900", "Housing"),
  tx("current", "2026-10-05", "Shop", "-100", "Groceries"),
  tx("current", "2026-09-28", "Salary", "3000", "Salary"),
  tx("current", "2026-09-03", "Rent", "-900", "Housing"),
  tx("current", "2026-09-10", "Shop", "-150", "Groceries"),
  tx("current", "2026-09-12", "Shop", "-50"),
  tx("current", "2026-08-28", "Salary", "3000", "Salary"),
  tx("current", "2026-08-03", "Rent", "-900", "Housing"),
  tx("other", "2026-09-15", "Other bank", "-999", "Housing"),
  tx("current", "2026-06-01", "Too old", "-5000", "Housing"),
];

describe("budget", () => {
  const result = budget(TRANSACTIONS, new Set(["current"]), "2026-10-29", 3);

  it("adds income and spending by month, the current month last", () => {
    expect(result.months).toEqual([
      { month: "2026-08", income: 3000, spending: 900 },
      { month: "2026-09", income: 3000, spending: 1100 },
      { month: "2026-10", income: 0, spending: 1000 },
    ]);
  });

  it("averages the months that are over", () => {
    expect(result.full).toBe(2);
    expect(result.income).toBe(3000);
    expect(result.spending).toBe(1000);
  });

  it("splits spending by category and payee, over the chosen accounts only", () => {
    expect(result.categories.map((c) => [c.key, c.value])).toEqual([
      ["Housing", 2700],
      ["Groceries", 250],
      [UNCATEGORISED, 50],
    ]);
    expect(result.categories[0]!.share).toBeCloseTo(0.9);
    expect(result.payees[0]).toEqual({ label: "Rent", spending: 2700, count: 3 });
    expect(result.transactions.map((t) => t.date)[0]).toBe("2026-10-05");
    expect(result.transactions).toHaveLength(8);
  });

  it("crosses into the previous year", () => {
    expect(budget([], new Set(), "2026-02-10", 3).months.map((m) => m.month)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});
