import { amount } from "@kerfin/core";
import type { Account, Connection } from "@kerfin/core";
import { useState } from "react";

import { AccountEditor } from "../components/AccountEditor";
import { AddAccount, ConnectForm } from "../components/AddAccount";
import { FinaryConnect } from "../components/FinaryConnect";
import { useJobs, useMinuteTick } from "../components/Jobs";
import { Dialog } from "../components/ui";
import { useData } from "../data";
import { engine } from "../engine";
import { ago, errorText, kindLabel, money, t } from "../i18n";

export function Accounts() {
  const { overview, institutions, institutionName, refresh } = useData();
  const { track } = useJobs();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  // The account whose details are open, below it.
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (account: Account) => setOpen((id) => (id === account.id ? null : account.id));
  useMinuteTick();

  if (!overview) return null;

  const manualGroups = new Map<string, Account[]>();
  for (const account of overview.accounts.filter((a) => !a.connection_id)) {
    const name = account.institution_name ?? "";
    manualGroups.set(name, [...(manualGroups.get(name) ?? []), account]);
  }

  async function syncAll() {
    const names = new Map(overview!.connections.map((c) => [c.id, c.label]));
    for (const job of await engine.syncAll()) track(job, names.get(job.connection_id) ?? "");
  }

  async function remove(connection: Connection) {
    if (!window.confirm(t("accounts.removeConfirm", { name: connection.label }))) return;
    await engine.removeConnection(connection.id);
    await refresh();
  }

  const editingInstitution = editing && institutions.find((i) => i.id === editing.institution);

  return (
    <>
      <div className="page-header">
        <h1>{t("accounts.title")}</h1>
        <div className="row">
          {overview.connections.length > 0 && (
            <button className="btn" onClick={() => void syncAll()}>
              {t("accounts.syncAll")}
            </button>
          )}
          <button className="btn primary" onClick={() => setAdding(true)}>
            {t("accounts.add")}
          </button>
        </div>
      </div>

      {overview.connections.map((connection) => (
        <section className="card" key={connection.id}>
          <div className="card-header">
            <div>
              <h2>{connection.label || institutionName(connection.institution)}</h2>
              <ConnectionStatus connection={connection} />
            </div>
            <div className="row">
              <button
                className="btn small"
                onClick={async () => track(await engine.sync(connection.id), connection.label)}
              >
                {t("accounts.sync")}
              </button>
              <button className="btn small ghost" onClick={() => setEditing(connection)}>
                {t("accounts.credentials")}
              </button>
              <button className="btn small ghost danger" onClick={() => void remove(connection)}>
                {t("accounts.remove")}
              </button>
            </div>
          </div>
          <AccountRows
            accounts={overview.accounts.filter((a) => a.connection_id === connection.id)}
            open={open}
            onToggle={toggle}
            onClose={() => setOpen(null)}
          />
        </section>
      ))}

      {[...manualGroups].map(([name, accounts]) => (
        <section className="card" key={`manual-${name}`}>
          <div className="card-header">
            <div>
              <h2>{name}</h2>
              <span className="status">{t("accounts.manual")}</span>
            </div>
          </div>
          <AccountRows accounts={accounts} open={open} onToggle={toggle} onClose={() => setOpen(null)} />
        </section>
      ))}

      <AddAccount open={adding} onClose={() => setAdding(false)} />
      <Dialog open={!!editing} onClose={() => setEditing(null)}>
        {editing && editing.institution === "finary" && (
          <FinaryConnect connectionId={editing.id} onBack={() => setEditing(null)} onDone={() => setEditing(null)} />
        )}
        {editing && editing.institution !== "finary" && editingInstitution && (
          <ConnectForm
            institution={editingInstitution}
            connection={editing}
            onBack={() => setEditing(null)}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </>
  );
}

function ConnectionStatus({ connection }: { connection: Connection }) {
  if (!connection.last_sync_at) return <span className="status">{t("accounts.neverSynced")}</span>;
  if (connection.last_status !== "ok") {
    return (
      <>
        <span className="status error">{errorText(connection.last_status)}</span>
        {connection.last_error && (
          <details className="error-details">
            <summary className="muted small">{t("accounts.errorDetails")}</summary>
            <code className="small">{connection.last_error}</code>
          </details>
        )}
      </>
    );
  }
  return <span className="status ok">{t("accounts.syncedAgo", { when: ago(connection.last_sync_at) })}</span>;
}

function AccountRows({
  accounts,
  open,
  onToggle,
  onClose,
}: {
  accounts: Account[];
  open: string | null;
  onToggle: (a: Account) => void;
  onClose: () => void;
}) {
  if (accounts.length === 0) return <p className="muted" style={{ margin: 0 }}>{t("accounts.noAccounts")}</p>;
  return (
    <div className="list">
      {accounts.map((account) => (
        <div key={account.id} className={open === account.id ? "account-item open" : "account-item"}>
        <button
          className={account.hidden ? "list-row dimmed" : "list-row"}
          aria-expanded={open === account.id}
          onClick={() => onToggle(account)}
        >
          <span>
            <div>{account.label}</div>
            <div className="muted small">
              {kindLabel(account.kind)}
              {account.number ? ` · ${account.number}` : ""}
              {account.hidden ? ` · ${t("accounts.hidden")}` : ""}
            </div>
          </span>
          <span className="num">
            {account.balance == null ? "–" : money(amount(account.balance), account.currency ?? "EUR")}
          </span>
        </button>
        {open === account.id && <AccountEditor key={account.id} account={account} onClose={onClose} />}
        </div>
      ))}
    </div>
  );
}
