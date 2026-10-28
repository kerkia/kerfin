// Accounts in groups (by insurer, by type...): each group's total and share, then its
// accounts with their share of the group.
import { amount } from "@kerfin/core";
import type { Account, AccountGroup } from "@kerfin/core";

import { money, percent, t } from "../i18n";

export function GroupTable({
  groups,
  groupLabel,
  details,
  groupHeader,
}: {
  groups: AccountGroup[];
  groupLabel: (key: string) => string;
  details: (account: Account) => string; // the second line under an account's name
  groupHeader: string;
}) {
  return (
    <div className="table-scroll">
      <table className="table portfolio group-table">
        <thead>
          <tr>
            <th>{groupHeader}</th>
            <th className="right">{t("portfolio.value")}</th>
            <th className="right">{t("groups.shareOfAll")}</th>
            <th className="right">{t("groups.shareOfGroup")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRows key={group.key} group={group} label={groupLabel(group.key)} details={details} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ group, label, details }: { group: AccountGroup; label: string; details: (a: Account) => string }) {
  return (
    <>
      <tr className="total-row">
        <td>
          <strong>{label}</strong>
          <span className="tag muted-tag">{t("portfolio.count", { n: group.accounts.length })}</span>
        </td>
        <td className="right num">
          <strong>{money(group.total, "EUR", { maximumFractionDigits: 0 })}</strong>
        </td>
        <td className="right num">{percent(group.share)}</td>
        <td />
      </tr>
      {group.accounts.map((account) => (
        <tr key={account.id}>
          <td className="indented">
            <div>{account.label}</div>
            <div className="muted small">{details(account)}</div>
          </td>
          <td className="right num">{money(amount(account.balance), account.currency ?? "EUR")}</td>
          <td />
          <td className="right num muted">{percent(amount(account.balance) / (group.total || 1))}</td>
        </tr>
      ))}
    </>
  );
}
