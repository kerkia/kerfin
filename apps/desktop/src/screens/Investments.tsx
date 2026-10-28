// What the investments are made of and how they performed. The period and currency at the
// top scope everything on the page.
import {
  PERFORMANCE_RANGES,
  amount,
  assetClass,
  assetClasses,
  breakdown,
  composition,
  holdingsHistory,
  indexOf,
  pricedHoldings,
  rangeStart,
  returns,
} from "@kerfin/core";
import type { Account, AccountKind, AssetClass, Breakdown, Market, Range } from "@kerfin/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BarList, Donut, DonutLegend, LineChart, donutSlices } from "../components/charts";
import { MultiSelect } from "../components/MultiSelect";
import { useData } from "../data";
import { engine } from "../engine";
import { kindLabel, money, percent, t } from "../i18n";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;
const OTHER = "__other"; // the folded rest of a breakdown

interface Pick {
  dimension: "class" | "countries" | "sectors";
  key: string;
  label: string;
  shown?: string[]; // for OTHER: the keys shown separately, which it excludes
}

/** How much of a holding the pick covers (0..1), or null when its composition is unknown. */
function exposure(market: Market, holding: Market["holdings"][number], kind: AssetClass, pick: Pick): number | null {
  if (pick.dimension === "class") {
    return pick.key === OTHER ? (pick.shown?.includes(kind) ? 0 : 1) : kind === pick.key ? 1 : 0;
  }
  const shares = composition(market, holding, pick.dimension);
  if (!shares) return null;
  if (pick.key !== OTHER) return shares[pick.key] ?? 0;
  return Object.entries(shares)
    .filter(([key]) => !pick.shown?.includes(key))
    .reduce((sum, [, share]) => sum + share, 0);
}
const TOP_COUNTRIES = 9;

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a convenience only
  }
}

export function InvestmentsPage() {
  const { overview } = useData();
  const [market, setMarket] = useState<Market | null>(null);
  const [range, setRange] = useState<Range>(() => stored("kerfin.invRange", PERFORMANCE_RANGES, "1Y"));
  const [currency, setCurrency] = useState<string>(() => stored("kerfin.currency", CURRENCIES, "EUR"));
  const [active, setActive] = useState<string | null>(null);
  // A class, country or sector picked in a breakdown: it filters the table.
  const [pick, setPick] = useState<Pick | null>(null);
  const toggle = (next: Pick) =>
    setPick((current) => (current?.dimension === next.dimension && current.key === next.key ? null : next));
  // Filters: no choice means everything.
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [accountIds, setAccountIds] = useState<Set<string>>(new Set());

  // Reload after each sync: the overview changes then.
  useEffect(() => {
    engine.market().then(setMarket, () => undefined);
  }, [overview]);

  const start = rangeStart(range, localToday());
  const kindOf = useMemo(
    () => new Map((overview?.accounts ?? []).map((a): [string, AccountKind] => [a.id, a.kind])),
    [overview],
  );
  const scope = useCallback(
    (all: Market): Market => ({
      ...all,
      holdings: all.holdings.filter(
        (h) =>
          (types.size === 0 || types.has(kindOf.get(h.account_id) ?? "")) &&
          (accountIds.size === 0 || accountIds.has(h.account_id)),
      ),
    }),
    [types, accountIds, kindOf],
  );
  const figures = useMemo(() => {
    if (!market) return null;
    const scoped = scope(market);
    const { priced, unpricedValue } = pricedHoldings(scoped);
    const pricedValue = priced.reduce((sum, p) => sum + amount(p.holding.valuation), 0);
    const history = holdingsHistory(scoped, currency, start);
    const classes = assetClasses(scoped);
    return {
      history,
      pricedShare: pricedValue / (pricedValue + unpricedValue || 1),
      unpricedValue,
      classes: donutSlices(
        classes.map((c) => ({ key: c.key, label: t(`class.${c.key}`), value: c.value })),
        t("portfolio.other"),
      ),
      classesTotal: classes.reduce((sum, c) => sum + c.value, 0),
      countries: breakdown(scoped, "countries"),
      sectors: breakdown(scoped, "sectors"),
      // Securities listed without a value are shown too, for their information.
      rows: scoped.holdings
        .filter((h) => amount(h.valuation) > 0 || h.match === "unpaired")
        .map((holding) => {
          const security = holding.isin ? scoped.securities[holding.isin] : undefined;
          const pricedHolding = priced.find((p) => p.holding === holding);
          return {
            holding,
            kind: assetClass(holding, security),
            index: indexOf(holding, scoped.indices, security),
            returns: pricedHolding ? returns(scoped, pricedHolding, currency, start) : null,
          };
        })
        .sort((a, b) => amount(b.holding.valuation) - amount(a.holding.valuation)),
      indexDate: scoped.indices[0]?.as_of ?? "",
    };
  }, [market, currency, start, scope]);

  const accounts = new Map((overview?.accounts ?? []).map((a): [string, Account] => [a.id, a]));
  const holdingsTotal = figures ? figures.rows.reduce((sum, r) => sum + amount(r.holding.valuation), 0) : 0;

  const header = (
    <div className="page-header">
      <h1>{t("inv.title")}</h1>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="segmented" role="radiogroup" aria-label={t("portfolio.period")}>
          {PERFORMANCE_RANGES.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={range === r}
              className={range === r ? "segment active" : "segment"}
              onClick={() => {
                setRange(r);
                store("kerfin.invRange", r);
              }}
            >
              {t(`range.${r}`)}
            </button>
          ))}
        </div>
        <select
          className="input compact"
          aria-label={t("inv.currency")}
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value);
            store("kerfin.currency", e.target.value);
          }}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
  const invested = [...new Set((market?.holdings ?? []).map((h) => h.account_id))]
    .map((id) => accounts.get(id))
    .filter((a): a is Account => !!a)
    .sort((a, b) => a.label.localeCompare(b.label));
  const filters = invested.length > 1 && (
    <div className="filters-row">
      <MultiSelect
        label={t("inv.accountTypes")}
        allLabel={t("inv.allAccountTypes")}
        options={[...new Set(invested.map((a) => a.kind))].map((k) => ({ value: k, label: kindLabel(k) }))}
        selected={types}
        onChange={setTypes}
      />
      <MultiSelect
        label={t("inv.accounts")}
        allLabel={t("inv.allAccounts")}
        options={invested
          .filter((a) => types.size === 0 || types.has(a.kind))
          .map((a) => ({ value: a.id, label: a.label }))}
        selected={accountIds}
        onChange={setAccountIds}
      />
    </div>
  );

  if (!figures) return header;
  const top = (
    <>
      {header}
      {filters}
    </>
  );
  if (figures.rows.length === 0) {
    return (
      <>
        {top}
        <div className="card empty">
          <p className="secondary" style={{ margin: 0 }}>
            {t("inv.empty")}
          </p>
        </div>
      </>
    );
  }

  const pickClass = (key: string) =>
    toggle({
      dimension: "class",
      key,
      label: figures.classes.find((s) => s.key === key)?.label ?? key,
      shown: figures.classes.filter((s) => s.key !== "__other").map((s) => s.key),
    });
  // The table, narrowed to what the pick covers, with how much of each holding it is.
  const exposed = pick !== null && pick.dimension !== "class";
  const rows = figures.rows
    .map((row) => ({ ...row, share: pick && market ? exposure(market, row.holding, row.kind, pick) : 1 }))
    .filter((row) => !pick || (row.share ?? 0) > 0);

  const first = figures.history[0];
  const last = figures.history[figures.history.length - 1];
  const change = first && last && first !== last ? last.value / first.value - 1 : null;

  return (
    <>
      {top}

      <section className="card">
        <div className="hero-label">{t("inv.value")}</div>
        {last ? (
          <>
            <div className="hero-value">{money(last.value, currency, { maximumFractionDigits: 0 })}</div>
            {change !== null && first && (
              <div className="row">
                <span className={change >= 0 ? "delta-up" : "delta-down"}>
                  <span className="num">
                    {change >= 0 ? "▲ " : "▼ "}
                    {percent(Math.abs(change))} · {money(last.value - first.value, currency, { signDisplay: "always", maximumFractionDigits: 0 })}
                  </span>
                </span>
              </div>
            )}
            <div style={{ marginTop: 12 }}>{figures.history.length >= 2 && <LineChart series={figures.history} currency={currency} />}</div>
            <p className="muted small" style={{ margin: "8px 0 0" }}>
              {t("inv.simulated")}{" "}
              {figures.pricedShare < 0.995 &&
                t("inv.coverage", {
                  covered: percent(figures.pricedShare),
                  missing: money(figures.unpricedValue, "EUR", { maximumFractionDigits: 0 }),
                })}
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {t("inv.noHistory")}
          </p>
        )}
      </section>

      <div className="grid-3">
        <section className="card">
          <div className="card-header">
            <h2>{t("inv.assetClasses")}</h2>
          </div>
          <div className="allocation stacked">
            <Donut
              slices={figures.classes}
              total={money(figures.classesTotal, "EUR", { maximumFractionDigits: 0 })}
              totalLabel={t("portfolio.total")}
              active={active}
              onActive={setActive}
              onSelect={pickClass}
            />
            <DonutLegend
              slices={figures.classes}
              active={active}
              onActive={setActive}
              selected={pick?.dimension === "class" ? pick.key : null}
              onSelect={pickClass}
            />
          </div>
        </section>
        <BreakdownCard
          title={t("inv.geography")}
          data={figures.countries}
          limit={TOP_COUNTRIES}
          selected={pick?.dimension === "countries" ? pick.key : null}
          onSelect={(key, label, shown) => toggle({ dimension: "countries", key, label, shown })}
        />
        <BreakdownCard
          title={t("inv.sectors")}
          data={figures.sectors}
          selected={pick?.dimension === "sectors" ? pick.key : null}
          onSelect={(key, label, shown) => toggle({ dimension: "sectors", key, label, shown })}
        />
      </div>

      <section className="card">
        <div className="card-header">
          <h2>{t("inv.funds")}</h2>
          {pick ? (
            <button className="filter-chip" onClick={() => setPick(null)} aria-label={t("inv.clearPick")}>
              {t("inv.showing", { what: pick.label })} <span aria-hidden>✕</span>
            </button>
          ) : (
            <span className="muted small">{t("inv.pickHint")}</span>
          )}
        </div>
        <div className="table-scroll">
          <table className="table portfolio">
            <thead>
              <tr>
                <th>{t("inv.fund")}</th>
                <th>{t("inv.class")}</th>
                <th>{t("inv.index")}</th>
                <th className="right">{t("portfolio.value")}</th>
                <th className="right">{t("portfolio.share")}</th>
                {exposed && <th className="right">{t("inv.exposure", { what: pick!.label })}</th>}
                <th className="right">
                  {t("inv.periodReturn")} ({t(`range.${range}`)})
                </th>
                <th className="right">{t("inv.oneYear")}</th>
                <th className="right">{t("inv.threeYears")}</th>
                <th className="right">{t("inv.fiveYears")}</th>
                <th className="right">{t("inv.fees")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ holding, kind, index, returns: r, share }, i) => (
                <tr key={`${holding.account_id}-${holding.isin ?? holding.label}-${i}`}>
                  <td>
                    <div>
                      {holding.label === "?" ? t("panel.unnamed") : holding.label} <MatchTag match={holding.match} />
                    </div>
                    <div className="muted small">
                      {[holding.isin, accounts.get(holding.account_id)?.label].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>
                    <span className="tag">{t(`class.${kind as AssetClass}`)}</span>
                  </td>
                  <td className="small secondary">
                    {index ? (
                      <span title={index.approximate ? t("inv.approximate", { index: index.name }) : undefined}>
                        {index.name}
                        {index.approximate ? " ≈" : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="right num">
                    {holding.valuation === null ? "—" : money(amount(holding.valuation), holding.currency ?? "EUR")}
                  </td>
                  <td className="right num">
                    {holding.valuation === null ? "—" : percent(amount(holding.valuation) / (holdingsTotal || 1))}
                  </td>
                  {exposed && (
                    <td className="right num">
                      {percent(share ?? 0)}
                      {holding.valuation !== null && (
                        <div className="muted small">
                          {money(amount(holding.valuation) * (share ?? 0), holding.currency ?? "EUR", {
                            maximumFractionDigits: 0,
                          })}
                        </div>
                      )}
                    </td>
                  )}
                  <Return value={r?.period} />
                  <Return value={r?.oneYear} />
                  <Return value={r?.threeYears} />
                  <Return value={r?.fiveYears} />
                  <td className="right num">{holding.fees ? percent(amount(holding.fees)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ margin: "10px 0 0" }}>
          {t("inv.sources", { date: figures.indexDate })}
        </p>
      </section>
    </>
  );
}

/**
 * Marks a security whose value is in doubt (see HoldingMatch). Pairing in ISIN order is
 * reliable (checked against Finary on two accounts), so only mismatched counts are marked.
 */
export function MatchTag({ match }: { match: string | null }) {
  if (match !== "order_uncertain" && match !== "unpaired") return null;
  return (
    <span className={`tag match-tag ${match}`} title={t(`match.${match}Help`)}>
      {t(`match.${match}`)}
    </span>
  );
}

function Return({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <td className="right muted">—</td>;
  return (
    <td className={`right num ${value >= 0 ? "delta-up" : "delta-down"}`}>
      {value >= 0 ? "▲ " : "▼ "}
      {percent(Math.abs(value))}
    </td>
  );
}

/** A split by country or sector, as shares of what is known, with how much is known.
 * Picking a row filters the table. */
function BreakdownCard({
  title,
  data,
  limit,
  selected,
  onSelect,
}: {
  title: string;
  data: Breakdown;
  limit?: number;
  selected: string | null;
  onSelect: (key: string, label: string, shown?: string[]) => void;
}) {
  const covered = data.covered || 1;
  let slices = data.slices.map((s) => ({ key: s.key, value: s.value, share: s.value / covered }));
  if (limit && slices.length > limit) {
    const rest = slices.slice(limit - 1).reduce((sum, s) => sum + s.value, 0);
    slices = [...slices.slice(0, limit - 1), { key: OTHER, value: rest, share: rest / covered }];
  }
  const label = (key: string) => (key === OTHER ? t("inv.otherCountries") : key);
  const shown = slices.filter((s) => s.key !== OTHER).map((s) => s.key);
  return (
    <section className="card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {data.covered > 0 ? (
        <>
          <BarList
            slices={slices}
            label={label}
            sharesOnly
            selected={selected}
            onSelect={(key) => onSelect(key, label(key), shown)}
          />
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {t("inv.breakdownCoverage", { covered: percent(data.covered / (data.total || 1)) })}
          </p>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          {t("inv.notCovered")}
        </p>
      )}
    </section>
  );
}
