// What the investments cost each year: the funds' own ongoing charges, and the yearly fees of
// the life insurance and PER contracts holding them, with what they add up to over time.
import { INSURED_KINDS, amount } from "./analytics";
import { assetClass, isCompanyShare } from "./investments";
import type { Market, MarketHolding } from "./investments";
import type { Account } from "./types";

/** A contract's yearly fees on one kind of holding, and where they come from. */
export interface ContractRate {
  rate: number;
  source: "user" | "suggested";
}

/** The contract fee on a holding: the user's rate, else the published one for its kind. */
export function contractRate(account: Account | undefined, euroFund: boolean): ContractRate | null {
  if (!account || !INSURED_KINDS.has(account.kind)) return null;
  if (account.fee_rate !== null && account.fee_rate !== undefined) return { rate: amount(account.fee_rate), source: "user" };
  const suggested = account.fees_suggested;
  if (!suggested) return null;
  // Some contracts only publish a cap for their euro fund: its fee is then unknown.
  const rate = euroFund ? suggested.euro : suggested.uc;
  return rate === null ? null : { rate: amount(rate), source: "suggested" };
}

export interface FeeLine {
  holding: MarketHolding;
  account: Account | undefined;
  value: number; // euros
  fundRate: number | null; // the fund's ongoing charges; 0 for shares and euro funds; null when unknown
  contract: ContractRate | null;
  yearly: number; // euros a year, from the rates known
}

export interface AccountFees {
  account: Account;
  value: number;
  fundFees: number; // euros a year
  contractFees: number; // euros a year
  contract: ContractRate | null; // on its funds (the euro fund's may differ)
  fundUnknown: number; // euros in funds whose charges aren't known
}

export interface FeeSummary {
  lines: FeeLine[]; // most expensive first
  accounts: AccountFees[]; // most expensive first
  value: number; // euros considered
  fundFees: number;
  contractFees: number;
  fundUnknown: number; // euros in funds whose charges aren't known
  contractsUnknown: Account[]; // life insurance and PER contracts without known fees
}

/** Yearly fees of every holding, by holding and by account (hidden accounts aside). */
export function feeSummary(market: Market, accounts: Account[]): FeeSummary {
  const byId = new Map(accounts.filter((a) => !a.hidden).map((a): [string, Account] => [a.id, a]));
  const lines: FeeLine[] = [];
  for (const holding of market.holdings) {
    const account = byId.get(holding.account_id);
    const value = amount(holding.valuation);
    if (!account || value <= 0) continue;
    const security = holding.isin ? market.securities[holding.isin] : undefined;
    const kind = assetClass(holding, security);
    const euroFund = kind === "euro_fund";
    // A company share has no ongoing charges; a euro fund's are the contract's.
    const known = euroFund || isCompanyShare(holding, security) ? 0 : null;
    const fundRate = holding.fees !== null ? amount(holding.fees) : known;
    const contract = contractRate(account, euroFund);
    lines.push({ holding, account, value, fundRate, contract, yearly: value * ((fundRate ?? 0) + (contract?.rate ?? 0)) });
  }

  const perAccount = new Map<string, AccountFees>();
  for (const line of lines) {
    const account = line.account!;
    const entry = perAccount.get(account.id) ?? {
      account,
      value: 0,
      fundFees: 0,
      contractFees: 0,
      contract: contractRate(account, false),
      fundUnknown: 0,
    };
    entry.value += line.value;
    entry.fundFees += line.value * (line.fundRate ?? 0);
    entry.contractFees += line.value * (line.contract?.rate ?? 0);
    if (line.fundRate === null) entry.fundUnknown += line.value;
    perAccount.set(account.id, entry);
  }
  // Contracts Finary gives no holdings for still cost their fees on their balance.
  for (const account of byId.values()) {
    if (perAccount.has(account.id) || !INSURED_KINDS.has(account.kind)) continue;
    const value = amount(account.balance);
    if (value <= 0) continue;
    const contract = contractRate(account, false);
    perAccount.set(account.id, {
      account,
      value,
      fundFees: 0,
      contractFees: value * (contract?.rate ?? 0),
      contract,
      fundUnknown: value,
    });
  }

  const all = [...perAccount.values()];
  const total = (key: "value" | "fundFees" | "contractFees" | "fundUnknown") => all.reduce((sum, a) => sum + a[key], 0);
  return {
    lines: lines.sort((a, b) => b.yearly - a.yearly),
    accounts: all.sort((a, b) => b.fundFees + b.contractFees - (a.fundFees + a.contractFees)),
    value: total("value"),
    fundFees: total("fundFees"),
    contractFees: total("contractFees"),
    fundUnknown: total("fundUnknown"),
    contractsUnknown: all.filter((a) => INSURED_KINDS.has(a.account.kind) && !a.contract).map((a) => a.account),
  };
}

/**
 * What yearly fees of `rate` cost over `years` on `value` growing at `growth` a year before
 * fees: the difference between the value grown without fees and with them.
 */
export function feeCost(value: number, rate: number, growth: number, years: number): number {
  return value * (1 + growth) ** years - value * ((1 + growth) * (1 - rate)) ** years;
}
