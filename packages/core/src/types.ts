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
  kind: AccountKind;
  subtype: string | null;
  number: string | null;
  currency: string | null;
  balance: string | null;
  opening_date: string | null;
  updated_at: string;
  hidden: boolean;
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
}

export interface Transaction {
  date: string;
  label: string;
  amount: string;
  currency: string | null;
  pending: boolean;
}

export interface Institution {
  id: string;
  name: string;
  products: string;
  connector: string;
  implemented: boolean;
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

export interface EngineStatus {
  vault: "missing" | "locked" | "unlocked";
  version: string;
  auto_lock_minutes: number | null;
}
