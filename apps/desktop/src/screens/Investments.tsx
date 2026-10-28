// What the investments are made of and how they performed. The period and currency at the
// top scope everything on the page.
import {
  PERFORMANCE_RANGES,
  amount,
  assetClass,
  assetClasses,
  breakdown,
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
      rows: scoped.holdings
        .filter((h) => amount(h.valuation) > 0)
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
            />
            <DonutLegend slices={figures.classes} active={active} onActive={setActive} />
          </div>
        </section>
        <BreakdownCard title={t("inv.geography")} data={figures.countries} limit={TOP_COUNTRIES} />
        <BreakdownCard title={t("inv.sectors")} data={figures.sectors} />
      </div>

      <section className="card">
        <div className="card-header">
          <h2>{t("inv.funds")}</h2>
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
              {figures.rows.map(({ holding, kind, index, returns: r }, i) => (
                <tr key={`${holding.account_id}-${holding.isin ?? holding.label}-${i}`}>
                  <td>
                    <div>{holding.label}</div>
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
                  <td className="right num">{money(amount(holding.valuation), holding.currency ?? "EUR")}</td>
                  <td className="right num">{percent(amount(holding.valuation) / (holdingsTotal || 1))}</td>
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

function Return({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <td className="right muted">—</td>;
  return (
    <td className={`right num ${value >= 0 ? "delta-up" : "delta-down"}`}>
      {value >= 0 ? "▲ " : "▼ "}
      {percent(Math.abs(value))}
    </td>
  );
}

/** A split by country or sector, as shares of what is known, with how much is known. */
function BreakdownCard({ title, data, limit }: { title: string; data: Breakdown; limit?: number }) {
  const covered = data.covered || 1;
  let slices = data.slices.map((s) => ({ key: s.key, value: s.value, share: s.value / covered }));
  if (limit && slices.length > limit) {
    const rest = slices.slice(limit - 1).reduce((sum, s) => sum + s.value, 0);
    slices = [...slices.slice(0, limit - 1), { key: t("inv.otherCountries"), value: rest, share: rest / covered }];
  }
  return (
    <section className="card">
      <div className="card-header">
        <h2>{title}</h2>
      </div>
      {data.covered > 0 ? (
        <>
          <BarList slices={slices} label={(key) => key} sharesOnly />
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
