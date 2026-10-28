// Every counted account with its share, value and change over the selected range.
import { accountHistory, accountInsurer, amount, changeSince } from "@kerfin/core";
import type { Account, AccountKind, BalancePoint, Change } from "@kerfin/core";
import { useMemo, useState } from "react";

import { kindLabel, money, percent, signedMoney, t } from "../i18n";

interface Row {
  account: Account;
  institution: string;
  insurer: string | null;
  value: number;
  share: number;
  change: Change | null;
}

type SortKey = "name" | "type" | "share" | "value" | "change";

export function AssetsTable({
  accounts,
  history,
  start,
  institutionOf,
  selectedId,
  onSelect,
}: {
  accounts: Account[]; // already counted: visible, with a balance, in euros
  history: BalancePoint[];
  start: string | null;
  institutionOf: (account: Account) => string;
  selectedId?: string | null;
  onSelect: (account: Account) => void;
}) {
  const [side, setSide] = useState<"assets" | "liabilities">("assets");
  const [kind, setKind] = useState<string>("");
  const [institution, setInstitution] = useState<string>("");
  const [insurer, setInsurer] = useState<string>("");
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "value", descending: true });

  const liabilities = accounts.some((a) => amount(a.balance) < 0);
  const rows = useMemo<Row[]>(() => {
    const onSide = accounts.filter((a) => (side === "assets" ? amount(a.balance) >= 0 : amount(a.balance) < 0));
    const total = onSide.reduce((sum, a) => sum + Math.abs(amount(a.balance)), 0) || 1;
    return onSide.map((account) => ({
      account,
      institution: institutionOf(account),
      insurer: accountInsurer(account),
      value: amount(account.balance),
      share: Math.abs(amount(account.balance)) / total,
      change: changeSince(accountHistory(history, account.id), start),
    }));
  }, [accounts, history, start, side, institutionOf]);

  const kinds = [...new Set(rows.map((r) => r.account.kind))].sort();
  const institutions = [...new Set(rows.map((r) => r.institution))].sort((a, b) => a.localeCompare(b));
  const insurers = [...new Set(rows.map((r) => r.insurer).filter((i): i is string => !!i))].sort();
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => (!kind || r.account.kind === kind) && (!institution || r.institution === institution))
    .filter((r) => !insurer || r.insurer === insurer)
    .filter((r) => !q || `${r.account.label} ${r.institution} ${r.insurer ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => compare(a, b, sort.key) * (sort.descending ? -1 : 1));

  const groups: [string | null, Row[]][] = grouped
    ? [...new Set(shown.map((r) => r.account.kind))].map((k) => [k, shown.filter((r) => r.account.kind === k)])
    : [[null, shown]];

  function header(key: SortKey, label: string, right = false) {
    const active = sort.key === key;
    return (
      <th
        className={right ? "right" : undefined}
        aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
      >
        <button
          className="sort-button"
          onClick={() => setSort({ key, descending: active ? !sort.descending : key !== "name" && key !== "type" })}
        >
          {label}
          <span aria-hidden className={active ? "sort-mark" : "sort-mark idle"}>
            {active && !sort.descending ? "↑" : "↓"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={side === "assets"} className="tab" onClick={() => setSide("assets")}>
            {t("portfolio.assets")}
          </button>
          {liabilities && (
            <button
              role="tab"
              aria-selected={side === "liabilities"}
              className="tab"
              onClick={() => setSide("liabilities")}
            >
              {t("portfolio.liabilities")}
            </button>
          )}
        </div>
      </div>

      <div className="table-tools">
        <select className="input compact" aria-label={t("portfolio.type")} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t("portfolio.allTypes")}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <select
          className="input compact"
          aria-label={t("portfolio.institution")}
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
        >
          <option value="">{t("portfolio.allInstitutions")}</option>
          {institutions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {insurers.length > 0 && (
          <select className="input compact" aria-label={t("portfolio.insurer")} value={insurer} onChange={(e) => setInsurer(e.target.value)}>
            <option value="">{t("portfolio.allInsurers")}</option>
            {insurers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <label className="checkbox toggle">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          <span>{t("portfolio.groupByType")}</span>
        </label>
        <input
          className="input compact search"
          type="search"
          placeholder={t("portfolio.search")}
          aria-label={t("portfolio.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="table-scroll">
        <table className="table portfolio">
          <thead>
            <tr>
              {header("name", t("portfolio.name"))}
              {header("type", t("portfolio.type"))}
              {header("share", t("portfolio.share"), true)}
              {header("value", t("portfolio.value"), true)}
              {header("change", t("portfolio.change"), true)}
            </tr>
          </thead>
          <tbody>
            <SummaryRow label={t("portfolio.total")} rows={shown} count />
            {groups.map(([group, groupRows]) => (
              <GroupRows key={group ?? "all"} group={group} rows={groupRows} selectedId={selectedId} onSelect={onSelect} />
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("portfolio.noMatch")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "name":
      return a.account.label.localeCompare(b.account.label);
    case "type":
      return kindLabel(a.account.kind).localeCompare(kindLabel(b.account.kind));
    case "share":
      return a.share - b.share;
    case "value":
      return a.value - b.value;
    case "change":
      return (a.change?.absolute ?? -Infinity) - (b.change?.absolute ?? -Infinity);
  }
}

function GroupRows({
  group,
  rows,
  selectedId,
  onSelect,
}: {
  group: string | null;
  rows: Row[];
  selectedId?: string | null;
  onSelect: (a: Account) => void;
}) {
  return (
    <>
      {group && <SummaryRow label={kindLabel(group as AccountKind)} rows={rows} group />}
      {rows.map((row) => (
        <tr
          key={row.account.id}
          className={row.account.id === selectedId ? "clickable selected" : "clickable"}
          aria-selected={row.account.id === selectedId}
          onClick={() => onSelect(row.account)}
        >
          <td>
            <div>{row.account.label}</div>
            <div className="muted small">
              {row.institution}
              {row.insurer && row.insurer !== row.institution ? ` · ${row.insurer}` : ""}
            </div>
          </td>
          <td>
            <span className="tag">{kindLabel(row.account.kind)}</span>
          </td>
          <td className="right num">{percent(row.share)}</td>
          <td className="right num">{money(row.value)}</td>
          <td className="right">
            <Delta change={row.change} />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Total of `rows`: the total line, or a group's subtotal. */
function SummaryRow({ label, rows, count, group }: { label: string; rows: Row[]; count?: boolean; group?: boolean }) {
  const value = rows.reduce((sum, r) => sum + r.value, 0);
  const share = rows.reduce((sum, r) => sum + r.share, 0);
  const changed = rows.filter((r) => r.change);
  const absolute = changed.reduce((sum, r) => sum + r.change!.absolute, 0);
  const opening = changed.reduce((sum, r) => sum + (r.value - r.change!.absolute), 0);
  const change: Change | null = changed.length
    ? { absolute, relative: opening ? absolute / Math.abs(opening) : null, from: "", partial: false }
    : null;
  return (
    <tr className={group ? "group-row" : "total-row"}>
      <td>
        <strong>{label}</strong>
        {count && <span className="tag muted-tag">{t("portfolio.count", { n: rows.length })}</span>}
      </td>
      <td />
      <td className="right num">{group ? percent(share) : ""}</td>
      <td className="right num">
        <strong>{money(value)}</strong>
      </td>
      <td className="right">
        <Delta change={change} />
      </td>
    </tr>
  );
}

/** A signed change with an arrow, so its direction never rests on color alone. */
export function Delta({ change }: { change: Change | null }) {
  if (!change) return <span className="muted">—</span>;
  const up = change.absolute >= 0;
  return (
    <span className={`delta ${change.absolute === 0 ? "" : up ? "delta-up" : "delta-down"}`}>
      <span className="num">{signedMoney(change.absolute)}</span>
      {change.relative !== null && (
        <span className="num small">
          {change.absolute === 0 ? "" : up ? "▲ " : "▼ "}
          {percent(Math.abs(change.relative))}
        </span>
      )}
    </span>
  );
}
