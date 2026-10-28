// Assurance-vie and PER contracts: totals by product and by insurer (the company holding
// the money, which matters for its guarantee), and each insurer's contracts.
import { INSURED_KINDS, accountInsurer, groupAccounts } from "@kerfin/core";
import { useMemo, useState } from "react";

import { BarList, Donut, DonutLegend, donutSlices } from "../components/charts";
import { GroupTable } from "../components/GroupTable";
import { useData } from "../data";
import { kindLabel, money, t } from "../i18n";

const UNSET = "__unset";

export function InsurancePage() {
  const { overview, accountInstitution } = useData();
  const [active, setActive] = useState<string | null>(null);

  const figures = useMemo(() => {
    if (!overview) return null;
    const insured = overview.accounts.filter((a) => INSURED_KINDS.has(a.kind));
    const byInsurer = groupAccounts(insured, (a) => accountInsurer(a) ?? UNSET);
    const byKind = groupAccounts(insured, (a) => a.kind);
    return { byInsurer, byKind, total: byInsurer.reduce((sum, g) => sum + g.total, 0) };
  }, [overview]);

  if (!overview || !figures) return null;
  const whole = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 });
  const insurerLabel = (key: string) => (key === UNSET ? t("portfolio.unknownInsurer") : key);
  const kindTotal = (kind: string) => figures.byKind.find((g) => g.key === kind);

  if (figures.total === 0) {
    return (
      <>
        <h1>{t("insurance.title")}</h1>
        <div className="card empty">
          <p className="secondary" style={{ margin: 0 }}>
            {t("insurance.empty")}
          </p>
        </div>
      </>
    );
  }

  const slices = donutSlices(
    figures.byInsurer.map((g) => ({ key: g.key === UNSET ? "__unset" : g.key, label: insurerLabel(g.key), value: g.total })),
    t("portfolio.other"),
  );

  return (
    <>
      <h1>{t("insurance.title")}</h1>

      <div className="kpi-row">
        <Kpi label={t("insurance.total")} value={whole(figures.total)} count={figures.byInsurer.reduce((n, g) => n + g.accounts.length, 0)} />
        {(["life_insurance", "retirement"] as const).map((kind) => (
          <Kpi
            key={kind}
            label={kindLabel(kind)}
            value={whole(kindTotal(kind)?.total ?? 0)}
            count={kindTotal(kind)?.accounts.length ?? 0}
          />
        ))}
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>{t("insurance.byInsurer")}</h2>
          </div>
          <div className="allocation">
            <Donut
              slices={slices}
              total={whole(figures.total)}
              totalLabel={t("portfolio.insuredTotal")}
              active={active}
              onActive={setActive}
            />
            <DonutLegend slices={slices} active={active} onActive={setActive} showValues />
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <h2>{t("insurance.amounts")}</h2>
          </div>
          <BarList
            slices={figures.byInsurer.map((g) => ({ key: g.key, value: g.total, share: g.share }))}
            label={insurerLabel}
          />
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>{t("insurance.contracts")}</h2>
        </div>
        <GroupTable
          groups={figures.byInsurer}
          groupLabel={insurerLabel}
          groupHeader={t("detail.insurer")}
          details={(account) => [kindLabel(account.kind), accountInstitution(account)].filter(Boolean).join(" · ")}
        />
      </section>
    </>
  );
}

function Kpi({ label, value, count }: { label: string; value: string; count: number }) {
  return (
    <section className="card kpi">
      <div className="hero-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      <div className="muted small">{t("insurance.contractsCount", { n: count })}</div>
    </section>
  );
}
