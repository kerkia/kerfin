import { amount } from "@kerfin/core";
import type { Account, Connection } from "@kerfin/core";
import { useState } from "react";

import { AccountDetail } from "../components/AccountDetail";
import { AddAccount, ConnectForm } from "../components/AddAccount";
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
  const [selected, setSelected] = useState<Account | null>(null);
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
            onSelect={setSelected}
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
          <AccountRows accounts={accounts} onSelect={setSelected} />
        </section>
      ))}

      <AddAccount open={adding} onClose={() => setAdding(false)} />
      <Dialog open={!!editing} onClose={() => setEditing(null)}>
        {editing && editingInstitution && (
          <ConnectForm
            institution={editingInstitution}
            connection={editing}
            onBack={() => setEditing(null)}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
      <AccountDetail account={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ConnectionStatus({ connection }: { connection: Connection }) {
  if (!connection.last_sync_at) return <span className="status">{t("accounts.neverSynced")}</span>;
  if (connection.last_status !== "ok") {
    return <span className="status error">{errorText(connection.last_status)}</span>;
  }
  return <span className="status ok">{t("accounts.syncedAgo", { when: ago(connection.last_sync_at) })}</span>;
}

function AccountRows({ accounts, onSelect }: { accounts: Account[]; onSelect: (a: Account) => void }) {
  if (accounts.length === 0) return <p className="muted" style={{ margin: 0 }}>{t("accounts.noAccounts")}</p>;
  return (
    <div className="list">
      {accounts.map((account) => (
        <button
          key={account.id}
          className={account.hidden ? "list-row dimmed" : "list-row"}
          onClick={() => onSelect(account)}
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
      ))}
    </div>
  );
}
