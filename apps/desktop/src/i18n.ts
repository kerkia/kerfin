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
  "nav.investments": "Investments",
  "nav.types": "Account types",
  "nav.insurance": "Assurance-vie & PER",
  "nav.income": "Fees & income",
  "nav.budget": "Budget",
  "fees.security": "Security fees per year",
  "fees.account": "Account fees per year",
  "fees.ofValue": "{rate} of {value} invested",
  "fees.ofInsured": "{rate} of {value} in life insurance and PER",
  "fees.noInsured": "No life insurance or PER contract",
  "fees.contractsUnknown": "Contract fees not known for: {names}.",
  "fees.setInAccounts": "Set them in Accounts",
  "fees.fundUnknown": "Finary gives no ongoing charges for {value} of funds: their fees are not counted.",
  "fees.notSet": "not set",
  "fees.unknown": "unknown",
  "fees.suggestedHelp": "Published fees of this contract (see Accounts to change them)",
  "fees.userHelp": "Set by you in Accounts",
  "fees.euroFund": "euro fund {rate}",
  "fees.overTime": "What fees cost over time",
  "fees.growth": "Assumed growth before fees",
  "fees.growthOption": "{rate} a year",
  "fees.years": "{n} years",
  "fees.overTimeHelp": "Value lost to security and account fees of {rate} a year on today's investments, if they grew {growth} a year before fees, with nothing added or withdrawn.",
  "fees.holdings": "Holdings",
  "fees.holding": "Holding",
  "fees.holdingsOf": "Holdings in {account}",
  "fees.allAccounts": "All accounts",
  "fees.filter": "Show the holdings of",
  "fees.rate": "Fees",
  "fees.inContract": "contract's",
  "fees.noHoldings": "Finary lists no holdings for this account: its account fees are counted on its balance.",
  "fees.perYear": "Fees /yr",
  "fees.total": "Total",
  "fees.accounts": "Account fees",
  "fees.accountCol": "Account",
  "fees.contractRate": "Rate",
  "fees.accountsHelp":
    "Life insurance and PER contracts' yearly fees, yours or the contract's published ones (marked *). Brokerage accounts' custody and trading fees aren't counted. Click an account to see only its figures and holdings, and the total to see them all again.",
  "fees.sources":
    "Security fees: funds' ongoing charges from Finary; shares have none, and a euro fund's are its contract's.",
  "income.expected": "Income over the next 12 months",
  "income.net": "Income minus fees",
  "income.netHelp": "Over a year, at today's holdings",
  "income.byMonth": "Expected distributions by month",
  "income.byMonthHelp": "Last year's distributions for the units held today, expected again in the same month.",
  "income.statedApart": "Interest stated by Finary ({value} a year) is credited once a year and not shown here.",
  "income.noDistributions": "None of today's holdings paid distributions over the last year.",
  "income.reinvestedHelp": "{value} is in {n} funds or shares that paid nothing over the last two years: accumulating funds reinvest their income, which shows in their price instead.",
  "income.yield": "Income",
  "income.perYear": "Income /yr",
  "income.source.distributions": "paid {n}×",
  "income.source.stated": "stated by Finary",
  "income.source.reinvested": "reinvested",
  "income.sources":
    "Income: distributions per unit from Yahoo Finance's quote data, for the units held today; interest of euro funds and similar lines as Finary states it. Savings accounts' interest isn't in Finary's data.",
  "sync.title": "Finary can't update some accounts",
  "sync.since": "last updated {date}",
  "sync.updated": "Updated by Finary {when}",
  "sync.help": "Their figures are as of that date. Reconnect them in Finary, then sync Kerfin again.",
  "budget.allAccounts": "All accounts",
  "budget.account": "Show the budget of",
  "budget.period": "Period",
  "budget.months": "Last {n} months",
  "budget.income": "Income a month",
  "budget.spending": "Spending a month",
  "budget.saved": "Saved a month",
  "budget.savedRate": "{rate} of income",
  "budget.averageOver": "Average over {n} full months",
  "budget.thisMonth": "Spent this month",
  "budget.thisMonthHelp": "{share} of a usual month so far",
  "budget.byMonth": "Spending by month",
  "budget.byMonthHelp": "The current month is still under way.",
  "budget.byCategory": "By category",
  "budget.byCategoryHelp": "Click a category to see its transactions.",
  "budget.uncategorised": "Uncategorised",
  "budget.payees": "Where the money goes",
  "budget.payee": "Payee",
  "budget.count": "Payments",
  "budget.total": "Spent",
  "budget.transactions": "Transactions",
  "budget.transactionsIn": "Transactions in {category}",
  "budget.allCategories": "All categories",
  "budget.date": "Date",
  "budget.label": "Description",
  "budget.category": "Category",
  "budget.amount": "Amount",
  "budget.pending": "pending",
  "budget.more": "Show {n} more",
  "budget.empty":
    "No transactions yet. Kerfin reads them from Finary at each sync, for the current accounts Finary's budget covers.",
  "budget.sources": "Transactions as Finary lists them, without transfers between your own accounts.",
  "types.title": "Account types",
  "types.shares": "Share of each type",
  "types.amounts": "Amount by type",
  "types.accounts": "Accounts by type",
  "insurance.title": "Assurance-vie & PER",
  "insurance.total": "All assurance-vie & PER",
  "insurance.contractsCount": "{n} contracts",
  "insurance.byInsurer": "Share of each insurer",
  "insurance.amounts": "Amount by insurer",
  "insurance.contracts": "Contracts by insurer",
  "insurance.empty": "No assurance-vie or PER yet. Set an account's type in Accounts if one is missing.",
  "groups.shareOfAll": "Share of total",
  "groups.shareOfGroup": "Share of group",
  "inv.themes": "Themes",
  "inv.themesHelp": "Holdings about one resource: the resource itself (physical metal, oil contracts…), or the companies producing it. What a fund holds comes from its official CFI code in the EU register; a company's theme from its industry.",
  "inv.noThemes": "No holding about a specific resource.",
  "theme.precious_metals": "Precious metals (physical)",
  "theme.miners": "Gold & silver miners",
  "theme.energy": "Oil & gas",
  "theme.rare_earths": "Rare earths & strategic metals",
  "theme.uranium": "Uranium",
  "theme.industrial_metals": "Industrial metals & mining",
  "theme.agriculture": "Agriculture",
  "theme.clean_energy": "Clean energy",
  "theme.broad_commodities": "Broad commodities",
  "inv.title": "Investments",
  "inv.currency": "Currency",
  "match.order_uncertain": "uncertain",
  "match.order_uncertainHelp": "Paired by order, but Finary gives a different number of values and funds for this account: some pairs are surely wrong. Check against Finary.",
  "match.unpaired": "no value",
  "match.unpairedHelp": "A fund Finary lists for this account without a value it could be paired with.",
  "inv.accountTypes": "account types",
  "inv.showing": "Showing: {what}",
  "inv.clearPick": "Show all funds",
  "inv.exposure": "In {what}",
  "inv.pickHint": "Click a class, country or sector to filter the table.",
  "inv.allAccountTypes": "All account types",
  "inv.accounts": "accounts",
  "inv.allAccounts": "All accounts",
  "filter.count": "{n} {what}",
  "filter.clear": "Clear",
  "inv.value": "Today's holdings over time",
  "inv.simulated":
    "Today's funds and shares priced over the period, as if held unchanged throughout: the performance of what you own now, not of your past contributions.",
  "inv.coverage": "Covers {covered} of your investments; the rest has no price history ({missing}).",
  "inv.noHistory": "No price history yet: it is collected after the next Finary sync.",
  "inv.assetClasses": "Asset classes",
  "inv.geography": "Geography",
  "inv.sectors": "Sectors",
  "inv.breakdownCoverage": "Known for {covered} of your investments, from each company's data and each fund's index or sector. Commodities held as such (physical metal, oil…) have no country or sector and are left out.",
  "inv.notCovered": "Not known for any holding yet.",
  "inv.otherCountries": "Other countries",
  "inv.funds": "Funds and shares",
  "inv.fund": "Name",
  "inv.class": "Class",
  "inv.index": "Index",
  "inv.periodReturn": "Period",
  "inv.oneYear": "1 year",
  "inv.threeYears": "3 years /yr",
  "inv.fiveYears": "5 years /yr",
  "inv.fees": "Fees /yr",
  "inv.approximate": "approximated by {index}",
  "inv.sources":
    "Sources: prices from Yahoo Finance (public quotes, checked against Finary's price), exchange rates from the ECB, index weights from MSCI factsheets ({date}), companies' countries from Wikidata, what each security is (fund, share, commodity ETC) from ESMA's register of financial instruments.",
  "inv.empty": "No funds or shares yet: Finary's holdings appear here after a sync.",
  "class.equities": "Equities",
  "class.bonds": "Bonds",
  "class.mixed": "Mixed",
  "class.money_market": "Money market",
  "class.euro_fund": "Euro fund",
  "class.real_estate": "Real estate",
  "class.commodities": "Commodities",
  "class.crypto": "Crypto",
  "class.other": "Other",
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
  "portfolio.byInsurer": "By insurer (assurance-vie, PER)",
  "portfolio.insuredTotal": "Assurance-vie & PER",
  "portfolio.unknownInsurer": "Insurer not set",
  "portfolio.insurer": "Insurer",
  "portfolio.allInsurers": "All insurers",
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
  "range.3Y": "3Y",
  "range.5Y": "5Y",
  "range.10Y": "10Y",
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
  "detail.kind": "Type",
  "panel.title": "Holdings of {name}",
  "panel.close": "Close",
  "panel.holding": "Holding",
  "panel.none": "No holdings for this account.",
  "panel.unnamed": "Unnamed holding",
  "panel.fund": "Fund (guessed) · value from Finary",
  "panel.uncertain":
    "Finary lists {values} values and {funds} funds for this account, so pairing them in order is surely wrong somewhere. Lines are numbered in Finary's order: check them against Finary.",
  "detail.insurer": "Insurer",
  "detail.insurerUnknown": "e.g. Spirica, Suravenir",
  "detail.feeRate": "Contract fees (% a year)",
  "detail.feeRateSuggested": "{rate} published for {contract}",
  "detail.feeRateNone": "e.g. 0.5",
  "detail.feeRateSource": "Source: {source}",
  "detail.feeRateInvalid": "A yearly rate below 10%, e.g. 0.5",
  "detail.insuredBy": "insured by {insurer}",
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
  life_insurance: "Assurance-vie",
  retirement: "PER",
  pea: "PEA",
  securities: "CTO",
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

/** A yearly rate (fees, yields): finer than `percent`, as 0.25%. */
export function rate(value: number): string {
  return new Intl.NumberFormat(LOCALE, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** A month (YYYY-MM) as its short name, and with its year. */
export function monthName(month: string, withYear = false): string {
  return new Intl.DateTimeFormat(LOCALE, { month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
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
