// Mirrors of the engine's JSON. Amounts arrive as decimal strings; field names and enum
// values are part of the engine's public contract (see engine/src/kerfin_engine/domain.py).

export const ACCOUNT_KINDS = [
  "checking",
  "savings",
  "life_insurance",
  "retirement",
  "pea",
  "securities",
  "employee_savings",
  "crowdfunding",
  "real_estate",
  "crypto",
  "card",
  "loan",
  "other",
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export interface Account {
  id: string;
  connection_id: string | null; // null for accounts entered by hand
  institution: string | null; // institution id, for connected accounts
  institution_name: string | null; // free text, for manual accounts
  label: string;
  kind: AccountKind; // the user's choice if any, else what the source says
  kind_detected: AccountKind;
  kind_set: boolean;
  insurer: string | null; // life insurance and PER: set by the user
  insurer_suggested: string | null; // known from the contract's name, until the user sets one
  fee_rate: string | null; // the contract's yearly fees as a fraction: set by the user
  fees_suggested?: ContractFees | null; // known from the contract's name, until the user sets them
  subtype: string | null;
  number: string | null;
  currency: string | null;
  balance: string | null;
  opening_date: string | null;
  updated_at: string;
  hidden: boolean;
  source_synced_at?: string | null; // Finary: when it last updated the account from its institution
  sync_warning?: string | null; // Finary: why it can't update it currently ("credentials_expired"...)
}

/** A contract's published yearly management fees, as fractions (see contract_fees.py). */
export interface ContractFees {
  contract: string; // the contract they are known for
  uc: string; // on units of account (funds, ETFs...)
  euro: string | null; // on the euro fund
  source: string; // where they are published
}

export interface Connection {
  id: string;
  institution: string;
  label: string;
  params: Record<string, string>;
  remember_secrets: boolean;
  created_at: string;
  last_sync_at: string | null;
  last_status: string | null; // "ok" or an error code
  last_error: string | null;
  removed_accounts?: string[]; // names of the accounts the user removed: syncs leave them out
}

export interface BalancePoint {
  account_id: string;
  date: string; // YYYY-MM-DD
  balance: string;
}

export interface Overview {
  connections: Connection[];
  accounts: Account[];
  history: BalancePoint[];
}

export interface Holding {
  label: string;
  isin: string | null;
  quantity: string | null;
  unit_value: string | null;
  unit_price: string | null;
  valuation: string | null;
  currency: string | null;
  value_date: string | null;
  match: HoldingMatch | null;
}

/**
 * How a holding's security was found: linked by the source, or guessed from the order of
 * the source's answer ("order_uncertain" when the counts differ), or a security listed
 * without a value ("unpaired").
 */
export type HoldingMatch = "linked" | "order" | "order_uncertain" | "unpaired";

export interface Transaction {
  date: string;
  label: string;
  amount: string;
  currency: string | null;
  pending: boolean;
  category?: string | null; // the source's spending category
  category_parent?: string | null; // its broader category, when the source has two levels
  payee?: string | null; // the merchant's name as the source cleans it up
}

/** Why a source lists no transactions, in its words (Finary: its plan, its budget set-up...). */
export interface TransactionsNotice {
  connection_id: string;
  availability: string;
  note: string;
}

/** An account found in a bank's export, and where its transactions would go. */
export interface ImportAccount {
  number: string;
  label: string;
  count: number;
  first: string; // YYYY-MM-DD
  last: string;
  income: string;
  spending: string;
  balance: string | null;
  target: string | null; // the account it went to last time, or of the same name
}

/** A transaction of any account, as the budget reads them. */
export interface AccountTransaction extends Transaction {
  account_id: string;
}

export interface Institution {
  id: string;
  name: string;
  products: string;
  connector: string;
  implemented: boolean;
  /** Can be added now; the others only serve existing connections. */
  offered: boolean;
}

export interface Prompt {
  key: string;
  label: string;
  secret: boolean;
  choices: string[];
  default: string | null;
  required: boolean;
  pattern: string | null;
}

export type JobState = "running" | "waiting" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  connection_id: string;
  state: JobState;
  prompt: Prompt | null;
  messages: string[];
  /** A code to scan with the institution's app (e.g. BoursoBank's proximity check). */
  qr_code: string | null;
  error: { code: string; detail: string } | null;
  accounts_found: number;
}

export interface FinarySignInStatus {
  state: "idle" | "waiting" | "done" | "failed";
  connection_id?: string;
  job?: Job;
  error?: { code: string; detail: string };
}

export interface EngineStatus {
  vault: "missing" | "locked" | "unlocked";
  version: string;
  auto_lock_minutes: number | null;
}
