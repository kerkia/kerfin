// All user-facing text goes through t(), so a French catalogue can be added next to `en`.
import type { AccountKind } from "@kerfin/core";

const en = {
  "app.loading": "Starting Kerfin…",
  "app.engineDown": "Kerfin's engine is not responding.",
  "app.retry": "Retry",

  "vault.createTitle": "Welcome to Kerfin",
  "vault.createIntro":
    "Choose a passphrase. It encrypts everything Kerfin stores on this computer: your accounts, balances and bank logins.",
  "vault.createWarning": "There is no way to recover it. Write it down somewhere safe, such as a password manager.",
  "vault.passphrase": "Passphrase",
  "vault.confirm": "Confirm passphrase",
  "vault.minLength": "At least {n} characters. A few unrelated words work well.",
  "vault.mismatch": "The two passphrases differ.",
  "vault.create": "Create my vault",
  "vault.unlockTitle": "Kerfin is locked",
  "vault.unlockIntro": "Enter your passphrase to open your data.",
  "vault.unlock": "Unlock",
  "vault.wrong": "Wrong passphrase.",

  "nav.overview": "Overview",
  "nav.accounts": "Accounts",
  "nav.settings": "Settings",
  "nav.lock": "Lock",

  "overview.title": "Overview",
  "overview.netWorth": "Net worth",
  "overview.over30Days": "over 30 days",
  "overview.assets": "Assets {assets} · Debts {debts}",
  "overview.otherCurrencies": "Not included yet (no currency conversion): {list}",
  "overview.history": "Net worth over time",
  "overview.historyEmpty": "The chart fills in as Kerfin syncs on different days.",
  "overview.byKind": "By type",
  "overview.byInstitution": "By institution",
  "overview.attention": "Needs attention",
  "portfolio.period": "Period",
  "portfolio.allocation": "Allocation",
  "portfolio.splitBy": "Split by",
  "portfolio.byAccount": "By account",
  "portfolio.byType": "By type",
  "portfolio.byInstitution": "By institution",
  "portfolio.other": "Other",
  "portfolio.total": "Total",
  "portfolio.count": "{n} accounts",
  "portfolio.since": "since {date}",
  "portfolio.sinceFirst": "since {date}, the first record",
  "portfolio.updated": "updated {when}",
  "portfolio.assets": "Assets",
  "portfolio.liabilities": "Liabilities",
  "portfolio.name": "Name",
  "portfolio.type": "Type",
  "portfolio.institution": "Institution",
  "portfolio.share": "Share",
  "portfolio.value": "Value",
  "portfolio.change": "Change",
  "portfolio.allTypes": "All types",
  "portfolio.allInstitutions": "All institutions",
  "portfolio.groupByType": "Group by type",
  "portfolio.search": "Search",
  "portfolio.noMatch": "No account matches.",
  "range.1D": "1D",
  "range.7D": "7D",
  "range.1M": "1M",
  "range.3M": "3M",
  "range.6M": "6M",
  "range.YTD": "YTD",
  "range.1Y": "1Y",
  "range.ALL": "All",
  "overview.emptyTitle": "No accounts yet",
  "overview.emptyBody": "Connect a bank or insurer, or enter an account by hand.",

  "accounts.title": "Accounts",
  "accounts.add": "Add account",
  "accounts.syncAll": "Sync all",
  "accounts.sync": "Sync",
  "accounts.credentials": "Update login",
  "accounts.remove": "Remove",
  "accounts.removeConfirm": "Remove {name} and all its data from Kerfin?",
  "accounts.manual": "Entered manually",
  "accounts.neverSynced": "Not synced yet",
  "accounts.errorDetails": "Technical details",
  "accounts.syncedAgo": "Synced {when}",
  "accounts.noAccounts": "No accounts found yet.",
  "accounts.hidden": "Excluded from totals",

  "detail.holdings": "Holdings",
  "detail.transactions": "Recent transactions",
  "detail.none": "Nothing collected for this account.",
  "detail.quantity": "Quantity",
  "detail.value": "Value",
  "detail.balance": "Balance",
  "detail.updateBalance": "Update balance",
  "detail.exclude": "Exclude from totals",
  "detail.rename": "Name",
  "detail.save": "Save",
  "detail.delete": "Delete account",
  "detail.deleteConfirm": "Delete {name}?",
  "detail.updated": "Updated {when}",

  "add.title": "Add an account",
  "finary.title": "Connect Finary",
  "finary.intro":
    "Kerfin reads the accounts you have linked in Finary, with read-only access: it can't change anything there, and your Finary password stays with Finary.",
  "finary.how":
    "Sign in on Finary's page in your browser and approve access. Kerfin then refreshes your data each time you unlock it.",
  "finary.signIn": "Sign in with Finary",
  "finary.browser": "Open Finary's page in",
  "finary.defaultBrowser": "Your default browser",
  "finary.waiting": "Finish signing in in your browser…",
  "finary.noBrowser": "If no browser window opened, copy this address into your browser:",
  "finary.copy": "Copy",
  "finary.copied": "Copied",
  "add.search": "Search an institution",
  "add.connect": "Connect",
  "add.manualTag": "Enter by hand",
  "add.otherManual": "Other institution (enter by hand)",
  "add.connectTitle": "Connect {name}",
  "add.covers": "Covers: {products}",
  "add.label": "Name in Kerfin",
  "add.remember": "Remember my password on this computer",
  "add.rememberHint":
    "Stored encrypted in your vault. If unticked, Kerfin asks for it at each sync.",
  "add.privacy": "Your login is only sent to {name}'s website, from this computer.",
  "add.loadingFields": "Loading…",
  "add.submit": "Connect",
  "add.back": "Back",
  "add.cancel": "Cancel",
  "add.manualTitle": "Enter an account by hand",
  "add.institution": "Institution",
  "add.accountName": "Account name",
  "add.kind": "Type",
  "add.balance": "Current balance",
  "add.currency": "Currency",
  "add.save": "Add",
  "add.invalidFormat": "Invalid format.",
  "add.required": "Required.",

  "jobs.connecting": "Connecting to {name}…",
  "jobs.needsInput": "{name} needs your input",
  "jobs.done": "{name}: {n} account(s) updated",
  "jobs.failed": "{name}: {error}",
  "jobs.cancelled": "{name}: cancelled",
  "jobs.send": "Send",
  "jobs.cancel": "Cancel",
  "jobs.scanTitle": "Scan this code with your phone",
  "jobs.scanHint":
    "{name} checks that your phone is next to this computer. In its app, follow the steps to approve the login and scan this code when asked. Kerfin carries on by itself once it's done.",
  "jobs.scanCode": "QR code to scan with the app",
  "jobs.hide": "Hide",

  "settings.title": "Settings",
  "settings.security": "Security",
  "settings.autoLock": "Lock automatically after",
  "settings.minutes": "{n} minutes",
  "settings.lockNow": "Lock now",
  "settings.storage":
    "Your data is encrypted with your passphrase and stays on this computer. Nothing is sent anywhere except to the institutions you connect.",
  "settings.about": "About",
  "settings.version": "Version {app} (engine {engine})",
  "settings.updates": "Updates",
  "settings.checkUpdates": "Check for updates",
  "settings.upToDate": "Kerfin is up to date.",
  "settings.updatesDev": "Updates are only available in the installed app.",

  "update.available": "Kerfin {version} is ready.",
  "settings.updateReady": "Kerfin {version} is ready: restart from the bar at the top of the window.",
  "update.install": "Restart to update",
  "update.installing": "Updating Kerfin…",
  "update.failed": "The update failed: {error}",

  "time.justNow": "just now",
  "time.minutes": "{n} min ago",
  "time.hours": "{n} h ago",
  "time.days": "{n} days ago",
} as const;

export type MessageKey = keyof typeof en;

const kinds: Record<AccountKind, string> = {
  checking: "Current account",
  savings: "Savings",
  life_insurance: "Life insurance",
  retirement: "Retirement (PER)",
  pea: "PEA",
  securities: "Securities (CTO)",
  employee_savings: "Employee savings",
  crowdfunding: "Crowdfunding",
  real_estate: "Real estate",
  crypto: "Crypto",
  card: "Card",
  loan: "Loan",
  other: "Other",
};

const errors: Record<string, string> = {
  invalid_credentials: "the login or password was refused",
  sign_in_needed: "Finary needs you to sign in again (Update login)",
  sign_in_cancelled: "access wasn't granted on Finary's page",
  action_needed: "the website needs you to do something first (log in on the website to see what)",
  interaction_required: "a confirmation is needed: sync again and keep Kerfin open",
  validation_failed: "the validation was refused or expired",
  captcha: "the website asked for a CAPTCHA, which Kerfin can't solve; try again later",
  blocked:
    "the website turns away automated access, so Kerfin can't collect this account; you can add its balance manually",
  site_unavailable: "the website is unavailable; try again later",
  connection_failed:
    "Kerfin couldn't connect to the website: security software on this computer, the network or the website itself blocks it",
  insecure_connection:
    "the website's identity couldn't be verified; your network may be inspecting traffic",
  not_supported: "this isn't supported for this institution",
  connector_unavailable: "this institution can't be connected yet",
  invalid_input: "a value has the wrong format",
  engine_unreachable: "Kerfin's engine is not responding",
  unexpected: "an unexpected error occurred",
};

const LOCALE = "en-GB";

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function kindLabel(kind: AccountKind): string {
  return kinds[kind] ?? kind;
}

export const KIND_OPTIONS = Object.keys(kinds) as AccountKind[];

export function errorText(code: string | null | undefined): string {
  return errors[code ?? "unexpected"] ?? errors.unexpected!;
}

export function money(value: number, currency = "EUR", options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency, ...options }).format(value);
}

export function compactMoney(value: number, currency = "EUR"): string {
  return money(value, currency, { notation: "compact", maximumFractionDigits: 1 });
}

export function signedMoney(value: number, currency = "EUR"): string {
  return money(value, currency, { signDisplay: "exceptZero", maximumFractionDigits: 0 });
}

export function percent(value: number, signed = false): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value);
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" }).format(new Date(iso));
}

export function longDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" }).format(new Date(iso));
}

export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t("time.justNow");
  if (minutes < 60) return t("time.minutes", { n: minutes });
  if (minutes < 48 * 60) return t("time.hours", { n: Math.round(minutes / 60) });
  return t("time.days", { n: Math.round(minutes / 1440) });
}
