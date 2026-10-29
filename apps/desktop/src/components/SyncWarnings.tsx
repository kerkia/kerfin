// Accounts Finary says it can't currently update from their institution: their figures are
// as of its last successful update, until the connection is fixed in Finary.
import type { Account } from "@kerfin/core";

import { longDate, t } from "../i18n";

/** Finary's reason ("credentials_expired") as words. */
export function syncReason(reason: string): string {
  const words = /^[a-z0-9_]+$/.test(reason) ? reason.replace(/_/g, " ") : reason;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SyncWarnings({ accounts }: { accounts: Account[] }) {
  const stale = accounts.filter((a) => a.sync_warning && !a.hidden);
  if (stale.length === 0) return null;
  // One line per institution and reason: they share a connection in Finary.
  const groups = new Map<string, Account[]>();
  for (const account of stale) {
    const key = `${account.institution_name ?? ""}\u0000${account.sync_warning}`;
    groups.set(key, [...(groups.get(key) ?? []), account]);
  }
  return (
    <section className="card attention">
      <div className="card-header">
        <h2>{t("sync.title")}</h2>
      </div>
      {[...groups.values()].map((group) => {
        const first = group[0]!;
        const since = group.map((a) => a.source_synced_at).find(Boolean);
        return (
          <div key={first.id} className="row" style={{ padding: "4px 0", flexWrap: "wrap" }}>
            <span className="status error" />
            <strong>{first.institution_name ?? group.map((a) => a.label).join(", ")}</strong>
            <span className="secondary">
              {syncReason(first.sync_warning!)}
              {since ? ` · ${t("sync.since", { date: longDate(since) })}` : ""}
            </span>
            {first.institution_name && <span className="muted small">{group.map((a) => a.label).join(", ")}</span>}
          </div>
        );
      })}
      <p className="muted small" style={{ margin: "6px 0 0" }}>
        {t("sync.help")}
      </p>
    </section>
  );
}
