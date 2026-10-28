import { describe, expect, it } from "vitest";

import {
  allocationByInstitution,
  allocationByKind,
  accountHistory,
  changeOver,
  changeSince,
  portfolioChange,
  rangeStart,
  netWorth,
  netWorthHistory,
} from "./analytics";
import type { Account, AccountKind } from "./types";

function account(id: string, kind: AccountKind, balance: string | null, extra: Partial<Account> = {}): Account {
  return {
    id,
    connection_id: "c1",
    institution: "boursobank",
    institution_name: null,
    label: id,
    kind,
    subtype: null,
    number: null,
    currency: "EUR",
    balance,
    opening_date: null,
    updated_at: "2026-01-01T00:00:00+00:00",
    hidden: false,
    ...extra,
  };
}

describe("netWorth", () => {
  it("adds assets and loans, skips cards, hidden accounts and other currencies", () => {
    const result = netWorth([
      account("a", "savings", "1000.50"),
      account("b", "life_insurance", "2000"),
      account("c", "loan", "-500"),
      account("d", "card", "-80"),
      account("e", "savings", "999", { hidden: true }),
      account("f", "crypto", "10", { currency: "USD" }),
      account("g", "savings", null),
    ]);
    expect(result.assets).toBeCloseTo(3000.5);
    expect(result.liabilities).toBe(-500);
    expect(result.total).toBeCloseTo(2500.5);
    expect(result.otherCurrencies).toEqual([{ currency: "USD", total: 10 }]);
  });
});

describe("allocation", () => {
  it("groups positive balances by kind, largest first", () => {
    const slices = allocationByKind([
      account("a", "savings", "100"),
      account("b", "savings", "100"),
      account("c", "pea", "600"),
      account("d", "loan", "-50"),
    ]);
    expect(slices.map((s) => [s.key, s.value, s.share])).toEqual([
      ["pea", 600, 0.75],
      ["savings", 200, 0.25],
    ]);
  });

  it("groups by institution name", () => {
    const slices = allocationByInstitution(
      [account("a", "savings", "1"), account("b", "pea", "3", { institution: "boursedirect" })],
      (a) => a.institution ?? "?",
    );
    expect(slices.map((s) => s.key)).toEqual(["boursedirect", "boursobank"]);
  });
});

describe("netWorthHistory", () => {
  it("carries each account's last balance forward", () => {
    const accounts = [account("a", "savings", "0"), account("b", "pea", "0"), account("x", "card", "0")];
    const series = netWorthHistory(
      [
        { account_id: "a", date: "2026-01-01", balance: "100" },
        { account_id: "b", date: "2026-01-02", balance: "50" },
        { account_id: "x", date: "2026-01-02", balance: "-999" },
        { account_id: "a", date: "2026-01-03", balance: "120" },
      ],
      accounts,
    );
    expect(series).toEqual([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 150 },
      { date: "2026-01-03", value: 170 },
    ]);
  });
});

describe("changeOver", () => {
  it("compares with the latest point at least N days old", () => {
    const series = [
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-20", value: 110 },
      { date: "2026-02-15", value: 132 },
    ];
    expect(changeOver(series, 30)).toEqual({ absolute: 32, relative: 0.32 });
    expect(changeOver(series, 365)).toBeNull();
  });
});

describe("ranges", () => {
  const series = [
    { date: "2026-01-10", value: 100 },
    { date: "2026-10-01", value: 150 },
    { date: "2026-10-27", value: 180 },
    { date: "2026-10-28", value: 200 },
  ];

  it("starts each range on the right day", () => {
    expect(rangeStart("1D", "2026-10-28")).toBe("2026-10-27");
    expect(rangeStart("1M", "2026-10-28")).toBe("2026-09-28");
    expect(rangeStart("YTD", "2026-10-28")).toBe("2026-01-01");
    expect(rangeStart("ALL", "2026-10-28")).toBeNull();
  });

  it("measures change from the range's opening value", () => {
    const day = changeSince(series, "2026-10-27");
    expect(day).toMatchObject({ absolute: 20, from: "2026-10-27", partial: false });
    expect(day?.relative).toBeCloseTo(20 / 180);
    // On 28 September the latest known value is still January's.
    expect(changeSince(series, "2026-09-28")).toMatchObject({ absolute: 100, from: "2026-01-10", partial: false });
    expect(changeSince(series, null)?.absolute).toBe(100);
  });

  it("flags a range longer than the history", () => {
    const change = changeSince(series, "2025-10-28");
    expect(change?.from).toBe("2026-01-10");
    expect(change?.partial).toBe(true);
  });

  it("has no change with a single point", () => {
    expect(changeSince([{ date: "2026-10-28", value: 5 }], "2026-10-27")).toBeNull();
  });

  it("reads one account's history", () => {
    const history = [
      { account_id: "a", date: "2026-10-28", balance: "2" },
      { account_id: "b", date: "2026-10-27", balance: "9" },
      { account_id: "a", date: "2026-10-27", balance: "1" },
    ];
    expect(accountHistory(history, "a")).toEqual([
      { date: "2026-10-27", value: 1 },
      { date: "2026-10-28", value: 2 },
    ]);
  });
});

describe("portfolio change", () => {
  it("leaves out accounts added during the range", () => {
    const accounts = [account("a", "savings", "120"), account("new", "savings", "500")];
    const history = [
      { account_id: "a", date: "2026-10-01", balance: "100" },
      { account_id: "a", date: "2026-10-28", balance: "120" },
      { account_id: "new", date: "2026-10-28", balance: "500" },
    ];
    expect(portfolioChange(history, accounts, "2026-10-01")).toEqual({
      absolute: 20,
      relative: 0.2,
      from: "2026-10-01",
      partial: false,
    });
  });
});
