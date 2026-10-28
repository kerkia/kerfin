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
}

export interface SecurityInfo {
  isin: string;
  symbol: string | null;
  currency: string | null; // of its prices
  quote_type: string | null; // EQUITY, ETF, MUTUALFUND
  sector: string | null; // company shares
  country: string | null; // company shares
}

export interface IndexProfile {
  id: string;
  name: string;
  source: string;
  as_of: string | null;
  match: string; // regular expression on the fund's name
  approximate: boolean;
  countries: Record<string, number>; // percent
  sectors: Record<string, number>; // percent
}

export interface Market {
  holdings: MarketHolding[];
  securities: Record<string, SecurityInfo>;
  prices: Record<string, [string, string][]>; // isin -> [date, close] in the security's currency
  fx: Record<string, [string, string][]>; // currency -> [date, units per euro]
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

/** What a fund is specifically about, when it is about a resource. */
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

// Tried in order: the most specific first, companies before the resource they extract.
const THEME_PATTERNS: [RegExp, Theme][] = [
  [/rare.earth|terres? rares|strategic metal|critical (metal|material|mineral)|lithium|battery (metal|tech)/i, "rare_earths"],
  [/uranium/i, "uranium"],
  [/clean energy|renewable|[ée]nergies? (renouvelable|propre)|solar|wind energy|hydrogen/i, "clean_energy"],
  [/miners?\b|mining|gold ?bugs|mines? d'or|aurif|junior gold/i, "miners"],
  [/\bgold\b|\bsilver\b|platinum|palladium|precious metal|m[ée]taux pr[ée]cieux|\bor physique\b/i, "precious_metals"],
  [/\boil\b|brent|\bwti\b|crude|p[ée]trole|natural gas|gaz naturel|\benergy\b|[ée]nergie/i, "energy"],
  [/copper|cuivre|nickel|alumin|\bzinc\b|industrial metal|base metal|m[ée]taux industriels/i, "industrial_metals"],
  [/(?<!ex[- ]?)agri|grains?\b|wheat|livestock/i, "agriculture"],
  [/commodit|mati[èe]res premi[èe]res/i, "broad_commodities"],
];

// Themes whose funds own the resource (or contracts on it) unless they hold companies.
const RESOURCE_THEMES: ReadonlySet<Theme> = new Set([
  "precious_metals",
  "energy",
  "industrial_metals",
  "agriculture",
  "broad_commodities",
]);
const COMPANY_HINT = /equity|equities|\bactions?\b|msci|s&p|stoxx|ftse|sector|producers|companies|miners?\b|mining/i;
const PHYSICAL_HINT = /physical|physique|\betc\b/i;
// The sector of funds that hold companies of one industry.
const THEME_SECTORS: Partial<Record<Theme, string>> = {
  miners: "Materials",
  rare_earths: "Materials",
  industrial_metals: "Materials",
  uranium: "Energy",
  energy: "Energy",
};

export function themeOf(holding: MarketHolding, security?: SecurityInfo): Theme | null {
  if (security?.quote_type === "EQUITY") return null; // a company share, not a fund
  const text = `${holding.label} ${holding.security_type ?? ""}`;
  return THEME_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function assetClass(holding: MarketHolding, security?: SecurityInfo): AssetClass {
  if (security?.quote_type === "EQUITY") return "equities";
  const text = `${holding.label} ${holding.security_type ?? ""}`;
  // A fund of gold miners holds companies (equities); a physical gold ETC holds metal.
  const theme = themeOf(holding, security);
  if (theme && RESOURCE_THEMES.has(theme)) {
    return COMPANY_HINT.test(text) && !PHYSICAL_HINT.test(text) ? "equities" : "commodities";
  }
  if (theme) return PHYSICAL_HINT.test(text) ? "commodities" : "equities";
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

/** The index a fund follows or resembles, from its name (equity funds only). */
export function indexOf(
  holding: MarketHolding,
  indices: IndexProfile[],
  security?: SecurityInfo,
): IndexProfile | null {
  if (security?.quote_type === "EQUITY" || assetClass(holding, security) !== "equities") return null;
  return indices.find((index) => new RegExp(index.match, "i").test(holding.label)) ?? null;
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
  total: number; // euros of all holdings considered
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
    total += value;
    const shares = composition(market, holding, dimension);
    if (!shares) continue;
    for (const [key, share] of Object.entries(shares)) totals.set(key, (totals.get(key) ?? 0) + value * share);
    covered += value;
  }
  const slices = [...totals].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  return { slices, covered, total };
}

/**
 * What one holding is made of, by country or sector, as fractions adding up to 1: a
 * company share is all in its own; an index fund follows its index. Null when unknown.
 */
export function composition(
  market: Market,
  holding: MarketHolding,
  dimension: "countries" | "sectors",
): Record<string, number> | null {
  const security = holding.isin ? market.securities[holding.isin] : undefined;
  if (security?.quote_type === "EQUITY") {
    const key =
      dimension === "countries" ? security.country : security.sector && (SECTOR_NAMES[security.sector] ?? security.sector);
    return key ? { [key]: 1 } : null;
  }
  // Funds of one industry's companies (gold miners...) sit in that industry's sector; their
  // countries aren't known.
  const theme = themeOf(holding, security);
  const themeSector = theme && assetClass(holding, security) === "equities" ? THEME_SECTORS[theme] : undefined;
  if (themeSector) return dimension === "sectors" ? { [themeSector]: 1 } : null;
  const index = indexOf(holding, market.indices, security);
  if (!index) return null;
  const weights = index[dimension];
  const sum = Object.values(weights).reduce((s, w) => s + w, 0) || 100;
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, weight / sum]));
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

function convert(market: Market, value: number, from: string, to: string, date: string): number | null {
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
