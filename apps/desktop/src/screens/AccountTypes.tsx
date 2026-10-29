// Savings and investments by type of account (assurance-vie, PER, PEA, CTO, savings...)
// rather than account by account: shares, amounts, and each type's accounts. Day-to-day
// accounts (current accounts, cards, loans) are left out.
import { accountInsurer, groupAccounts } from "@kerfin/core";
import type { AccountKind } from "@kerfin/core";
import { useMemo, useState } from "react";

import { BarList, Donut, DonutLegend, donutSlices } from "../components/charts";
import { GroupTable } from "../components/GroupTable";
import { useData } from "../data";
import { kindLabel, money, t } from "../i18n";

const DAY_TO_DAY = new Set<AccountKind>(["checking", "card", "loan"]);

export function AccountTypesPage() {
  const { overview, accountInstitution } = useData();
  const [active, setActive] = useState<string | null>(null);

  const groups = useMemo(
    () => (overview ? groupAccounts(overview.accounts, (a) => (DAY_TO_DAY.has(a.kind) ? null : a.kind)) : []),
    [overview],
  );
  if (!overview) return null;

  const total = groups.reduce((sum, g) => sum + g.total, 0);
  const whole = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 });
  const label = (key: string) => kindLabel(key as AccountKind);
  const slices = donutSlices(
    groups.map((g) => ({ key: g.key, label: label(g.key), value: g.total })),
    t("portfolio.other"),
  );

  return (
    <>
      <h1>{t("types.title")}</h1>
      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h2>{t("types.shares")}</h2>
          </div>
          <div className="allocation">
            <Donut slices={slices} total={whole(total)} totalLabel={t("portfolio.total")} active={active} onActive={setActive} />
            <DonutLegend slices={slices} active={active} onActive={setActive} showValues />
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <h2>{t("types.amounts")}</h2>
          </div>
          <BarList slices={groups.map((g) => ({ key: g.key, value: g.total, share: g.share }))} label={label} />
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>{t("types.accounts")}</h2>
        </div>
        <GroupTable
          groups={groups}
          groupLabel={label}
          groupHeader={t("portfolio.type")}
          details={(account) => [accountInstitution(account), accountInsurer(account)].filter(Boolean).join(" · ")}
        />
      </section>
    </>
  );
}
