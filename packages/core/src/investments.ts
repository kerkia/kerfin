// What the investments are made of and how they performed: asset classes, geography and
// sectors, and the history of today's holdings priced over time, in any currency.
import type { HistoryPoint } from "./analytics";
import { amount } from "./analytics";
import type { HoldingMatch } from "./types";

export interface MarketHolding {
  account_id: string;
  label: string;
  isin: string | null;
  valuation: string | null;
  currency: string | null;
  unit_value: string | null;
  unit_value_currency: string | null;
  security_type: string | null;
  fees: string | null; // yearly, as a fraction
  match: HoldingMatch | null;
  annual_yield?: string | null; // yearly yield the source states for the line, as a fraction
}

export interface SecurityInfo {
  isin: string;
  symbol: string | null;
  currency: string | null; // of its prices
  quote_type: string | null; // EQUITY, ETF, MUTUALFUND
  sector: string | null; // company shares
  country: string | null; // company shares
  industry?: string | null; // company shares
  cfi?: string | null; // ISO 10962 code from ESMA's register; "" when not listed there
}

export interface IndexProfile {
  id: string;
  name: string;
  source: string;
  as_of: string | null;
  match: string; // regular expression on the fund's name
  approximate: boolean;
  sector?: string; // a sector index (MSCI World Health Care...): matched by sector, not by name
  countries: Record<string, number>; // percent
  sectors: Record<string, number>; // percent
}

export interface Market {
  holdings: MarketHolding[];
  securities: Record<string, SecurityInfo>;
  prices: Record<string, [string, string][]>; // isin -> [date, close] in the security's currency
  fx: Record<string, [string, string][]>; // currency -> [date, units per euro]
  dividends?: Record<string, [string, string][]>; // isin -> [ex-date, amount per unit] in the security's currency
  indices: IndexProfile[];
}

export const ASSET_CLASSES = [
  "equities",
  "bonds",
  "mixed",
  "money_market",
  "euro_fund",
  "real_estate",
  "commodities",
  "crypto",
  "other",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

// Tried in order on the fund's name and type: the most specific first.
const CLASS_PATTERNS: [RegExp, AssetClass][] = [
  [/fonds? (en )?euros?|euro fund|actif g[ée]n[ée]ral|support euros?|garanti/i, "euro_fund"],
  [/\bscpi\b|\bsci\b|\bopci\b|immobili|real.estate|reit|pierre/i, "real_estate"],
  [/mon[ée]taire|money.market|tr[ée]sorerie|\bcash\b|liquidit/i, "money_market"],
  [/obligat|\bbonds?\b|\bcredit\b|cr[ée]dit|treasury|aggregate|high.yield|govt|government|\btaux\b/i, "bonds"],
  [/flexible|patrimoine|allocation|diversifi|mixed|multi.?asset|[ée]quilibr|prudent|dynamique|balanced/i, "mixed"],
  [/crypto|bitcoin|ethereum/i, "crypto"],
  [/equity|equities|\bactions?\b|stock|share|msci|s&p|nasdaq|stoxx|cac|ftse|dow|nikkei|topix|small.?cap|\betf\b/i, "equities"],
];

/** What a holding is specifically about, when it is about a resource. */
export const THEMES = [
  "precious_metals",
  "miners",
  "energy",
  "rare_earths",
  "uranium",
  "industrial_metals",
  "agriculture",
  "clean_energy",
  "broad_commodities",
] as const;
export type Theme = (typeof THEMES)[number];

// The resource a fund's name is about, the most specific first. Whether the fund owns the
// resource or the companies producing it is decided by what the fund is (see holdsResource):
// gold here stands for gold itself and gold miners alike.
const THEME_PATTERNS: [RegExp, Theme][] = [
  [/rare.earth|terres? rares|strategic metal|critical (metal|material|mineral)|lithium|battery (metal|tech)/i, "rare_earths"],
  [/uranium/i, "uranium"],
  [/clean energy|renewable|[ée]nergies? (renouvelable|propre)|solar|wind energy|hydrogen/i, "clean_energy"],
  [/\bgold\b|\bsilver\b|platinum|palladium|precious metal|m[ée]taux pr[ée]cieux|\bor physique\b|mines? d'or|aurif|gold ?bugs/i, "precious_metals"],
  [/\boil\b|brent|\bwti\b|crude|p[ée]trole|natural gas|gaz naturel|\benergy\b|[ée]nergie/i, "energy"],
  [/miners?\b|mining|mini[eè]res?\b|copper|cuivre|nickel|alumin|\bzinc\b|industrial metal|base metal|m[ée]taux industriels/i, "industrial_metals"],
  [/(?<!ex[- ]?)agri|grains?\b|wheat|livestock/i, "agriculture"],
  [/commodit|mati[èe]res premi[èe]res/i, "broad_commodities"],
];

// A company's theme, from its industry (Yahoo Finance's names, as Morningstar's).
const INDUSTRY_THEMES: [RegExp, Theme][] = [
  [/^gold$|silver|precious metals/i, "miners"],
  [/uranium/i, "uranium"],
  [/^oil & gas|coal/i, "energy"],
  [/copper|alumin|steel|industrial metals/i, "industrial_metals"],
  [/solar|renewable/i, "clean_energy"],
  [/agricultural|farm products/i, "agriculture"],
];

// Themes whose funds may own the resource itself (or contracts on it).
const RESOURCE_THEMES: ReadonlySet<Theme> = new Set([
  "precious_metals",
  "energy",
  "industrial_metals",
  "agriculture",
  "broad_commodities",
]);
const COMPANY_HINT = /equity|equities|\bactions?\b|msci|s&p|stoxx|ftse|sector|producers|companies|miners?\b|mining/i;
// UCITS funds can't own commodities: a fund about gold owns gold miners.
const FUND_HINT = /\bfunds?\b|\bfonds\b|sicav|\bfcp\b|ucits/i;
const PHYSICAL_HINT = /physical|physique|\betc\b|\betn\b/i;
/**
 * Kerfin's one sector beyond GICS's: the mining of precious metals, apart from the rest of
 * Materials (chemicals, construction materials, base metals...). Index profiles split their
 * Materials weight accordingly where MSCI publishes the data (see update_index_profiles.py).
 */
export const PRECIOUS_MINING = "Precious Metals Mining";
const PRECIOUS_INDUSTRY = /^gold$|silver|precious metals/i;
// The sector of funds that hold companies of one industry.
const THEME_SECTORS: Partial<Record<Theme, string>> = {
  miners: PRECIOUS_MINING,
  rare_earths: "Materials",
  industrial_metals: "Materials",
  uranium: "Energy",
  energy: "Energy",
};
// Funds of one sector, by name (energy and materials funds are found by their theme).
const SECTOR_PATTERNS: [RegExp, string][] = [
  [/health ?care|sant[ée]|pharma|biotech|m[ée]dical/i, "Health Care"],
  [/information tech|\btech(nology|nologies)?\b|technolog|semiconductor|semi-?conducteur|software|logiciel/i, "Information Technology"],
  [/financials|\bbanks?\b|banques?|valeurs financi[eè]res/i, "Financials"],
  [/consumer discretionary|luxury|\bluxe\b/i, "Consumer Discretionary"],
  [/consumer staples|biens de consommation de base/i, "Consumer Staples"],
  [/\bindustrials\b|valeurs industrielles/i, "Industrials"],
  [/\butilities\b|services aux collectivit/i, "Utilities"],
  [/communication services|t[ée]l[ée]com/i, "Communication Services"],
  [/\bmaterials\b|mat[ée]riaux/i, "Materials"],
];
// Indices spanning the world: a world sector fund is described by the sector's world index.
const WORLDWIDE = new Set(["msci-world", "msci-acwi", "msci-acwi-imi"]);

type Nature = "company" | "fund" | "note" | "bond";

function describe(holding: MarketHolding): string {
  return `${holding.label} ${holding.security_type ?? ""}`;
}

/**
 * What a holding is: from its CFI code in ESMA's register (the EU's official reference) when
 * listed there, else from what the price source and Finary say. Null when unknown.
 */
function natureOf(holding: MarketHolding, security?: SecurityInfo): Nature | null {
  const cfi = security?.cfi ?? "";
  if (cfi.startsWith("DB")) return "bond";
  if (cfi.startsWith("D") || cfi.startsWith("EY")) return "note"; // ETCs, ETNs, certificates
  if (cfi.startsWith("CB") || cfi.startsWith("E")) return "company"; // CB: real estate investment trusts
  if (cfi.startsWith("C")) return "fund";
  const type = holding.security_type?.toLowerCase();
  if (security?.quote_type === "EQUITY" || type === "equity" || type === "stock") {
    // Physical metal trusts are quoted like companies.
    return PHYSICAL_HINT.test(holding.label) ? "fund" : "company";
  }
  if (security?.quote_type === "ETF" || security?.quote_type === "MUTUALFUND" || type === "etf" || type === "fund") {
    return "fund";
  }
  return null;
}

/** Whether a holding is a company's shares (or a REIT's), not a fund or a note. */
export function isCompanyShare(holding: MarketHolding, security?: SecurityInfo): boolean {
  return natureOf(holding, security) === "company";
}

function nameTheme(holding: MarketHolding): Theme | null {
  const text = describe(holding);
  return THEME_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** Whether a fund or note about `theme` owns the resource itself (or contracts on it) rather than companies. */
function holdsResource(holding: MarketHolding, security: SecurityInfo | undefined, theme: Theme): boolean {
  const text = describe(holding);
  const cfi = security?.cfi ?? "";
  if (PHYSICAL_HINT.test(text)) return true;
  const nature = natureOf(holding, security);
  if (nature === "note") return true;
  // A fund's CFI code says what it holds: C for commodities (letter 5).
  if (cfi.startsWith("C")) return cfi[4] === "C";
  if (cfi) return false;
  // Not in the register.
  if (theme === "broad_commodities") return !COMPANY_HINT.test(text);
  if (!RESOURCE_THEMES.has(theme)) return false;
  return !(COMPANY_HINT.test(text) || FUND_HINT.test(text) || security?.quote_type === "MUTUALFUND");
}

/** What a holding is about, when it is about a resource: the resource itself, or its producers. */
export function themeOf(holding: MarketHolding, security?: SecurityInfo): Theme | null {
  if (natureOf(holding, security) === "company") {
    const industry = security?.industry ?? "";
    return (industry && INDUSTRY_THEMES.find(([pattern]) => pattern.test(industry))?.[1]) || null;
  }
  const theme = nameTheme(holding);
  if (!theme || holdsResource(holding, security, theme)) return theme;
  return theme === "precious_metals" ? "miners" : theme;
}

export function assetClass(holding: MarketHolding, security?: SecurityInfo): AssetClass {
  const nature = natureOf(holding, security);
  if (nature === "company") return "equities";
  if (nature === "bond") return "bonds";
  const theme = nameTheme(holding);
  if (theme) return holdsResource(holding, security, theme) ? "commodities" : "equities";
  const text = describe(holding);
  for (const [pattern, kind] of CLASS_PATTERNS) if (pattern.test(text)) return kind;
  return security?.quote_type === "ETF" ? "equities" : "other";
}

/** Holdings by theme, in euros, largest first, with the total of all holdings. */
export function themes(market: Market): { slices: { key: Theme; value: number }[]; total: number } {
  const totals = new Map<Theme, number>();
  let total = 0;
  for (const holding of market.holdings) {
    const value = amount(holding.valuation);
    if (value <= 0) continue;
    total += value;
    const theme = themeOf(holding, holding.isin ? market.securities[holding.isin] : undefined);
    if (theme) totals.set(theme, (totals.get(theme) ?? 0) + value);
  }
  return { slices: [...totals].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value), total };
}

interface FundProfile {
  index: IndexProfile | null; // the index describing it, shown in the table
  sectors: Record<string, number> | null; // fractions adding up to 1
  countries: Record<string, number> | null;
}

function fractions(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((s, w) => s + w, 0) || 100;
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, weight / sum]));
}

/**
 * What an equity fund is made of: a fund of one sector (by its theme or name) is all in that
 * sector, with the countries of the sector's world index (or of its region's index); other
 * funds follow the index their name names. Funds of one industry's companies (gold
 * miners...) are in that industry's sector; their countries aren't known.
 */
function fundProfile(holding: MarketHolding, indices: IndexProfile[], security?: SecurityInfo): FundProfile {
  const none = { index: null, sectors: null, countries: null };
  if (natureOf(holding, security) === "company" || assetClass(holding, security) !== "equities") return none;
  const broad = indices.find((index) => !index.sector && new RegExp(index.match, "i").test(holding.label)) ?? null;
  const theme = themeOf(holding, security);
  const sector = theme ? THEME_SECTORS[theme] : SECTOR_PATTERNS.find(([pattern]) => pattern.test(holding.label))?.[1];
  if (!sector) {
    if (theme || !broad) return none;
    return { index: broad, sectors: fractions(broad.sectors), countries: fractions(broad.countries) };
  }
  // Mining companies are spread unlike the world's materials companies: no countries.
  if (theme && theme !== "energy") return { ...none, sectors: { [sector]: 1 } };
  const sectorIndex = indices.find((i) => i.sector === sector) ?? null;
  const regional = broad && !WORLDWIDE.has(broad.id) ? { ...broad, approximate: true } : null;
  const index = regional ?? sectorIndex;
  // The sector index's own split (a materials fund holds some precious metals miners).
  const sectors = sectorIndex ? fractions(sectorIndex.sectors) : { [sector]: 1 };
  return { index, sectors, countries: index ? fractions(index.countries) : null };
}

/** The index a fund follows or resembles (equity funds only). */
export function indexOf(
  holding: MarketHolding,
  indices: IndexProfile[],
  security?: SecurityInfo,
): IndexProfile | null {
  return fundProfile(holding, indices, security).index;
}

// The sources' sector names, as the MSCI factsheets name them.
const SECTOR_NAMES: Record<string, string> = {
  Technology: "Information Technology",
  "Financial Services": "Financials",
  Healthcare: "Health Care",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Basic Materials": "Materials",
  "Communication Services": "Communication Services",
  Industrials: "Industrials",
  Energy: "Energy",
  Utilities: "Utilities",
  "Real Estate": "Real Estate",
};

export interface Breakdown {
  slices: { key: string; value: number }[]; // value in euros, largest first
  covered: number; // euros whose composition is known
  total: number; // euros of all holdings considered (commodities have no country or sector)
}

/**
 * Holdings split by country or sector: company shares by their own, equity funds by the
 * weights of their index. The rest isn't covered (the share is reported, not guessed).
 */
export function breakdown(market: Market, dimension: "countries" | "sectors"): Breakdown {
  const totals = new Map<string, number>();
  let covered = 0;
  let total = 0;
  for (const holding of market.holdings) {
    const value = amount(holding.valuation);
    if (value <= 0) continue;
    const security = holding.isin ? market.securities[holding.isin] : undefined;
    if (assetClass(holding, security) === "commodities") continue;
    total += value;
    const shares = composition(market, holding, dimension);
    if (!shares) continue;
    for (const [key, share] of Object.entries(shares)) totals.set(key, (totals.get(key) ?? 0) + value * share);
    covered += value;
  }
  const slices = [...totals].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  return { slices, covered, total };
}

const REGIONS = new Intl.DisplayNames(["en"], { type: "region" });

/** The country an ISIN was issued in (its first two letters), where a company is registered. */
function isinCountry(isin: string | null): string | null {
  const code = isin?.slice(0, 2) ?? "";
  if (!/^[A-Z]{2}$/.test(code) || code === "XS" || code === "EU") return null; // international issues
  try {
    const name = REGIONS.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/**
 * What one holding is made of, by country or sector, as fractions adding up to 1: a
 * company share is all in its own; a fund follows its sector or index. Null when unknown.
 */
export function composition(
  market: Market,
  holding: MarketHolding,
  dimension: "countries" | "sectors",
): Record<string, number> | null {
  const security = holding.isin ? market.securities[holding.isin] : undefined;
  if (natureOf(holding, security) === "company") {
    const key =
      dimension === "countries"
        ? (security?.country ?? isinCountry(holding.isin))
        : PRECIOUS_INDUSTRY.test(security?.industry ?? "")
          ? PRECIOUS_MINING
          : security?.sector && (SECTOR_NAMES[security.sector] ?? security.sector);
    return key ? { [key]: 1 } : null;
  }
  return fundProfile(holding, market.indices, security)[dimension];
}

/** Holdings by asset class, in euros, largest first. */
export function assetClasses(market: Market): { key: AssetClass; value: number }[] {
  const totals = new Map<AssetClass, number>();
  for (const holding of market.holdings) {
    const value = amount(holding.valuation);
    if (value <= 0) continue;
    const kind = assetClass(holding, holding.isin ? market.securities[holding.isin] : undefined);
    totals.set(kind, (totals.get(kind) ?? 0) + value);
  }
  return [...totals].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

// Prices and exchange rates

type Series = [string, string][];

/** The last value on or before `date` (series sorted by date), or null. */
function valueAt(series: Series | undefined, date: string): number | null {
  if (!series?.length || series[0]![0] > date) return null;
  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (series[middle]![0] <= date) low = middle;
    else high = middle - 1;
  }
  return amount(series[low]![1]);
}

/** Units of `currency` for one euro on `date` (pence count as hundredths of a pound). */
function perEuro(market: Market, currency: string, date: string): number | null {
  if (currency === "EUR") return 1;
  if (currency === "GBp") {
    const pound = perEuro(market, "GBP", date);
    return pound === null ? null : pound * 100;
  }
  // Before the first published rate (or between rates), the nearest earlier one.
  return valueAt(market.fx[currency], date) ?? (market.fx[currency]?.length ? amount(market.fx[currency]![0]![1]) : null);
}

export function convert(market: Market, value: number, from: string, to: string, date: string): number | null {
  if (from === to) return value;
  const source = perEuro(market, from, date);
  const target = perEuro(market, to, date);
  return source && target ? (value / source) * target : null;
}

export interface PricedHolding {
  holding: MarketHolding;
  security: SecurityInfo;
  prices: Series;
}

/** Holdings with a price history, and the value of those without (not in the history). */
export function pricedHoldings(market: Market): { priced: PricedHolding[]; unpricedValue: number } {
  const priced: PricedHolding[] = [];
  let unpricedValue = 0;
  for (const holding of market.holdings) {
    const security = holding.isin ? market.securities[holding.isin] : undefined;
    const prices = holding.isin ? market.prices[holding.isin] : undefined;
    if (security?.currency && prices?.length && amount(holding.valuation) > 0) {
      priced.push({ holding, security, prices });
    } else {
      unpricedValue += Math.max(amount(holding.valuation), 0);
    }
  }
  return { priced, unpricedValue };
}

/**
 * What today's priced holdings would have been worth on each day since `start`, in
 * `currency`, as if held unchanged throughout. Day-to-day changes are chained from the
 * holdings priced on both days, so a holding whose history starts later adds its moves,
 * not its value, from then on (as performance indices are built).
 */
export function holdingsHistory(market: Market, currency: string, start: string | null): HistoryPoint[] {
  const { priced } = pricedHoldings(market);
  const dates = new Set<string>();
  for (const { prices } of priced) for (const [date] of prices) if (start === null || date >= start) dates.add(date);
  const sorted = [...dates].sort();
  // Keep charts light: about one point a week beyond two years.
  const step = sorted.length > 520 ? Math.ceil(sorted.length / 520) : 1;
  const shown = sorted.filter((_, i) => i % step === 0 || i === sorted.length - 1);
  const today = sorted[sorted.length - 1];
  if (!today) return [];
  // Each holding as a number of units: today's value over today's price.
  const units = priced.map(({ holding, security, prices }) => {
    const latest = amount(prices[prices.length - 1]![1]);
    const value = convert(market, amount(holding.valuation), holding.currency ?? "EUR", security.currency!, today);
    return value === null || !latest ? 0 : value / latest;
  });
  // Each holding's value on each shown day, in `currency` (null before its history).
  const values = shown.map((date) =>
    priced.map(({ security, prices }, i) => {
      const price = valueAt(prices, date);
      return price === null || !units[i] ? null : convert(market, units[i]! * price, security.currency!, currency, date);
    }),
  );
  const growth = [1];
  for (let d = 1; d < shown.length; d++) {
    let before = 0;
    let after = 0;
    values[d]!.forEach((value, i) => {
      const previous = values[d - 1]![i];
      if (value !== null && previous !== null && previous !== undefined) {
        before += previous;
        after += value;
      }
    });
    growth.push(growth[d - 1]! * (before ? after / before : 1));
  }
  // Scaled so the last point is today's value of everything priced.
  const now = values[values.length - 1]!.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const end = growth[growth.length - 1]!;
  return shown.map((date, d) => ({ date, value: (now * growth[d]!) / end }));
}

export interface Returns {
  period: number | null; // over the selected period
  oneYear: number | null;
  threeYears: number | null; // a year, annualised
  fiveYears: number | null; // a year, annualised
}

function yearsBefore(date: string, years: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCFullYear(day.getUTCFullYear() - years);
  return day.toISOString().slice(0, 10);
}

/** A security's returns, in `currency` (so they include exchange rate moves). */
export function returns(market: Market, priced: PricedHolding, currency: string, start: string | null): Returns {
  const { prices, security } = priced;
  const today = prices[prices.length - 1]![0];
  const valueOn = (date: string) => {
    const price = valueAt(prices, date);
    return price === null ? null : convert(market, price, security.currency!, currency, date);
  };
  const now = valueOn(today);
  const change = (from: string, years?: number) => {
    if (prices[0]![0] > from || now === null) return null; // history too short
    const then = valueOn(from);
    if (!then) return null;
    return years ? (now / then) ** (1 / years) - 1 : now / then - 1;
  };
  return {
    period: change(start ?? prices[0]![0]),
    oneYear: change(yearsBefore(today, 1)),
    threeYears: change(yearsBefore(today, 3), 3),
    fiveYears: change(yearsBefore(today, 5), 5),
  };
}
