// The portfolio at a glance: net worth and its change over a chosen period, how it is
// split, and every account. The period picker scopes everything on the page.
import {
  RANGES,
  allocationByInstitution,
  allocationByKind,
  amount,
  countedAccounts,
  netWorth,
  netWorthHistory,
  portfolioChange,
  rangeStart,
  seriesSince,
} from "@kerfin/core";
import type { Account, Range } from "@kerfin/core";
import { useMemo, useState } from "react";

import { AccountDetail } from "../components/AccountDetail";
import { AddAccount } from "../components/AddAccount";
import { Delta, AssetsTable } from "../components/AssetsTable";
import { Donut, DonutLegend, LineChart, donutSlices } from "../components/charts";
import { useMinuteTick } from "../components/Jobs";
import { useData } from "../data";
import { ago, errorText, kindLabel, longDate, money, t } from "../i18n";

type Split = "account" | "kind" | "institution";

/** Today in local time, as the engine dates its snapshots. */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a convenience only
  }
}

export function OverviewPage({ onNavigate }: { onNavigate: (page: "accounts") => void }) {
  const { overview, accountInstitution, institutionName } = useData();
  const [adding, setAdding] = useState(false);
  const [range, setRange] = useState<Range>(() => remembered("kerfin.range", RANGES, "1M"));
  const [split, setSplit] = useState<Split>(() => remembered("kerfin.split", ["account", "kind", "institution"] as const, "account"));
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  useMinuteTick();

  const start = rangeStart(range, localToday());
  const figures = useMemo(() => {
    if (!overview) return null;
    const counted = countedAccounts(overview.accounts).filter((a) => (a.currency ?? "EUR") === "EUR");
    const history = netWorthHistory(overview.history, overview.accounts);
    const items =
      split === "account"
        ? counted.map((a) => ({ key: a.id, label: a.label, value: amount(a.balance) }))
        : (split === "kind"
            ? allocationByKind(overview.accounts).map((s) => ({ ...s, label: kindLabel(s.key) }))
            : allocationByInstitution(overview.accounts, accountInstitution).map((s) => ({ ...s, label: s.key }))
          ).map(({ key, label, value }) => ({ key, label, value }));
    return {
      counted,
      worth: netWorth(overview.accounts),
      shown: seriesSince(history, start),
      // Each account's change, as in the table: an account added in the period isn't a gain.
      change: portfolioChange(overview.history, overview.accounts, start),
      slices: donutSlices(items, t("portfolio.other")),
      lastUpdate: overview.accounts.map((a) => a.updated_at).sort().pop(),
    };
  }, [overview, accountInstitution, split, start]);

  if (!overview || !figures) return null;

  if (overview.accounts.length === 0) {
    return (
      <>
        <h1>{t("overview.title")}</h1>
        <div className="card empty">
          <h2>{t("overview.emptyTitle")}</h2>
          <p className="secondary" style={{ margin: 0 }}>
            {t("overview.emptyBody")}
          </p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            {t("accounts.add")}
          </button>
        </div>
        <AddAccount open={adding} onClose={() => setAdding(false)} />
      </>
    );
  }

  const failing = overview.connections.filter((c) => c.last_status && c.last_status !== "ok");
  const { worth, change } = figures;
  const whole = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 });

  return (
    <>
      <div className="page-header">
        <h1>{t("overview.title")}</h1>
        <div className="segmented" role="radiogroup" aria-label={t("portfolio.period")}>
          {RANGES.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={range === r}
              className={range === r ? "segment active" : "segment"}
              onClick={() => {
                setRange(r);
                remember("kerfin.range", r);
              }}
            >
              {t(`range.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {failing.length > 0 && (
        <section className="card attention">
          <div className="card-header">
            <h2>{t("overview.attention")}</h2>
            <button className="btn small" onClick={() => onNavigate("accounts")}>
              {t("nav.accounts")}
            </button>
          </div>
          {failing.map((c) => (
            <div key={c.id} className="row" style={{ padding: "4px 0" }}>
              <span className="status error" />
              <strong>{c.label || institutionName(c.institution)}</strong>
              <span className="secondary">{errorText(c.last_status)}</span>
            </div>
          ))}
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="hero-label">{t("overview.netWorth")}</div>
          <div className="hero-value">{whole(worth.total)}</div>
          <div className="row secondary" style={{ flexWrap: "wrap" }}>
            <Delta change={change} />
            {change && (
              <span className="muted small">
                {change.partial
                  ? t("portfolio.sinceFirst", { date: longDate(change.from) })
                  : t("portfolio.since", { date: longDate(change.from) })}
              </span>
            )}
            {figures.lastUpdate && <span className="muted small">· {t("portfolio.updated", { when: ago(figures.lastUpdate) })}</span>}
          </div>
          <div className="secondary small" style={{ marginTop: 4 }}>
            {t("overview.assets", { assets: whole(worth.assets), debts: whole(worth.liabilities) })}
          </div>
          {worth.otherCurrencies.length > 0 && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              {t("overview.otherCurrencies", {
                list: worth.otherCurrencies.map((o) => money(o.total, o.currency)).join(", "),
              })}
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            {figures.shown.length >= 2 ? (
              <LineChart series={figures.shown} />
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                {t("overview.historyEmpty")}
              </p>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t("portfolio.allocation")}</h2>
            <select
              className="input compact"
              style={{ width: "auto" }}
              aria-label={t("portfolio.splitBy")}
              value={split}
              onChange={(e) => {
                setSplit(e.target.value as Split);
                remember("kerfin.split", e.target.value);
              }}
            >
              <option value="account">{t("portfolio.byAccount")}</option>
              <option value="kind">{t("portfolio.byType")}</option>
              <option value="institution">{t("portfolio.byInstitution")}</option>
            </select>
          </div>
          <div className="allocation">
            <Donut
              slices={figures.slices}
              total={whole(worth.assets)}
              totalLabel={t("portfolio.total")}
              active={active}
              onActive={setActive}
            />
            <DonutLegend slices={figures.slices} active={active} onActive={setActive} />
          </div>
        </section>
      </div>

      <AssetsTable
        accounts={figures.counted}
        history={overview.history}
        start={start}
        institutionOf={accountInstitution}
        onSelect={setSelected}
      />
      <AccountDetail account={selected} onClose={() => setSelected(null)} />
    </>
  );
}

