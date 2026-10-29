import { describe, expect, it } from "vitest";

import { budget, lastMonths } from "./budget";
import { DEFAULT_CATEGORIES, categorise, categoryKey, payeeKey, transferPairs, withRequired } from "./categories";
import type { AccountTransaction } from "./types";

function tx(
  account_id: string,
  date: string,
  label: string,
  amount: string,
  category: string | null = null,
  payee: string | null = null,
): AccountTransaction {
  return { account_id, date, label, amount, currency: "EUR", pending: false, category, payee };
}

const TRANSACTIONS = [
  tx("current", "2026-10-03", "Rent", "-900", "Logement"),
  tx("current", "2026-10-05", "Some Shop", "-100", "Alimentation"),
  tx("current", "2026-09-28", "Salary", "3000", "Salaires"),
  tx("current", "2026-09-03", "Rent", "-900", "Logement"),
  tx("current", "2026-09-10", "Some Shop", "-150", "Alimentation"),
  tx("current", "2026-09-12", "Mystery", "-50"),
  tx("current", "2026-08-28", "Salary", "3000", "Salaires"),
  tx("current", "2026-08-03", "Rent", "-900", "Logement"),
  tx("other", "2026-09-15", "Other bank", "-999", "Logement"),
  tx("current", "2026-06-01", "Too old", "-5000", "Logement"),
];

describe("budget", () => {
  const result = budget(TRANSACTIONS, new Set(["current"]), lastMonths("2026-10-29", 3), "2026-10-29");

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
      ["housing", 2700],
      ["groceries", 250],
      ["other", 50],
    ]);
    expect(result.categories[0]!.share).toBeCloseTo(0.9);
    expect(result.payees[0]).toMatchObject({ key: "rent", spending: 2700, count: 3 });
    expect(result.transactions[0]!.date).toBe("2026-10-05");
    expect(result.transactions).toHaveLength(8);
  });

  it("follows the user's categories and leaves transfers out", () => {
    const moved = [
      ...TRANSACTIONS,
      tx("current", "2026-09-20", "VIR SEPA vers livret", "-500"),
      tx("savings", "2026-09-21", "VIR SEPA recu", "500"),
    ];
    const mine = budget(moved, new Set(["current", "savings"]), lastMonths("2026-10-29", 3), "2026-10-29", { "some shop": "leisure" });
    expect(mine.months[1]).toEqual({ month: "2026-09", income: 3000, spending: 1100 });
    // Also when only one of the two accounts is shown.
    const one = budget(moved, new Set(["current"]), lastMonths("2026-10-29", 3), "2026-10-29");
    expect(one.months[1]!.spending).toBe(1100);
    expect(mine.categories.find((c) => c.key === "leisure")?.value).toBe(250);
  });

  it("counts refunds against their category", () => {
    const refunded = [...TRANSACTIONS, tx("current", "2026-09-11", "Some Shop", "40", "Alimentation")];
    const result = budget(refunded, new Set(["current"]), lastMonths("2026-10-29", 3), "2026-10-29");
    expect(result.categories.find((c) => c.key === "groceries")?.value).toBe(210);
    expect(result.months[1]!.income).toBe(3000);
  });

  it("covers a chosen range, averaging the months it spans whole", () => {
    const range = budget(TRANSACTIONS, new Set(["current"]), { from: "2026-08-15", to: "2026-09-30" }, "2026-10-29");
    expect(range.months.map((m) => [m.month, m.income, m.spending])).toEqual([
      ["2026-08", 3000, 0],
      ["2026-09", 3000, 1100],
    ]);
    expect([range.full, range.spending]).toEqual([1, 1100]);
  });

  it("leaves ignored payees out altogether", () => {
    const result = budget(TRANSACTIONS, new Set(["current"]), lastMonths("2026-10-29", 3), "2026-10-29", { rent: "ignored" });
    expect(result.months[0]).toEqual({ month: "2026-08", income: 3000, spending: 0 });
    expect(result.categories.some((c) => c.key === "ignored" || c.key === "housing")).toBe(false);
  });

  it("crosses into the previous year", () => {
    expect(budget([], new Set(), lastMonths("2026-02-10", 3), "2026-02-10").months.map((m) => m.month)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("categories", () => {
  it("names payees by the bank's merchant name, else the label's words", () => {
    expect(payeeKey({ label: "CARTE 27/10/26 SOME GROCER CB*1234", payee: "Some Grocer" })).toBe("some grocer");
    expect(payeeKey({ label: "CARTE 27/10/26 SOME GROCER CB*1234" })).toBe("some grocer");
    expect(payeeKey({ label: "PRLV SEPA Électricité Co REF 991" })).toBe("electricite co");
  });

  it("prefers the user's rule, then transfers, then known merchants, then the bank", () => {
    const [mine, merchant, bank, none] = categorise(
      [
        tx("a", "2026-10-01", "Shop", "-1", "Alimentation", "Some Shop"),
        tx("a", "2026-10-01", "CARTE MONOPRIX PARIS", "-1", "Shopping"),
        tx("a", "2026-10-01", "Somewhere", "-1", "Restaurants"),
        tx("a", "2026-10-01", "Somewhere else", "-1"),
      ],
      { "some shop": "health" },
    );
    expect([mine, merchant, bank, none].map((t) => [t!.key, t!.origin])).toEqual([
      ["health", "yours"],
      ["groceries", "kerfin"],
      ["restaurants", "bank"],
      ["other", "none"],
    ]);
  });

  it("pairs transfers between accounts within four days", () => {
    const pairs = transferPairs([
      tx("a", "2026-10-01", "out", "-200"),
      tx("b", "2026-10-04", "in", "200"),
      tx("a", "2026-10-01", "far", "-300"),
      tx("b", "2026-10-09", "too late", "300"),
      tx("a", "2026-10-02", "same account", "-50"),
      tx("a", "2026-10-02", "same account", "50"),
    ]);
    expect([...pairs].sort()).toEqual([0, 1]);
  });

  it("drops rules and Kerfin's categories the user removed", () => {
    const trimmed = DEFAULT_CATEGORIES.filter((c) => c.key !== "groceries" && c.key !== "health");
    const [shop] = categorise([tx("a", "2026-10-01", "CARTE MONOPRIX", "-1", "Alimentation")], { monoprix: "health" }, trimmed);
    expect([shop!.key, shop!.origin]).toEqual(["other", "none"]);
  });

  it("adds the categories Kerfin relies on to an older saved list, Other last", () => {
    const saved = [{ key: "my_food", kind: "spending" as const }, { key: "transfers", kind: "excluded" as const }, { key: "other", kind: "spending" as const }];
    expect(withRequired(saved).map((c) => c.key)).toEqual(["my_food", "transfers", "ignored", "other"]);
  });

  it("gives new categories keys of their own", () => {
    const mine = [...DEFAULT_CATEGORIES, { key: "my_pets", kind: "spending" as const }];
    expect(categoryKey("Pets!", mine)).toBe("my_pets_2");
    expect(categoryKey("Garden", mine)).toBe("my_garden");
  });
});
