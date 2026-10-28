// An account's details, edited in place below it in the account list. Only the fields the
// user changes are saved, so a sync that updates the account meanwhile is never undone.
import { INSURED_KINDS } from "@kerfin/core";
import type { Account, AccountKind } from "@kerfin/core";
import { useState } from "react";

import { useData } from "../data";
import { engine } from "../engine";
import { KIND_OPTIONS, ago, kindLabel, t } from "../i18n";

interface Changes {
  label?: string;
  kind?: AccountKind;
  insurer?: string;
  balance?: string;
  hidden?: boolean;
}

export function AccountEditor({ account, onClose }: { account: Account; onClose: () => void }) {
  const { refresh } = useData();
  const [changes, setChanges] = useState<Changes>({});
  const [busy, setBusy] = useState(false);
  const manual = !account.connection_id;
  const change = (values: Changes) => setChanges((all) => ({ ...all, ...values }));

  const label = changes.label ?? account.label;
  const kind = changes.kind ?? account.kind;
  // The insurer known from the contract's name fills the field until the user sets one.
  const insurer = changes.insurer ?? account.insurer ?? account.insurer_suggested ?? "";
  const balance = changes.balance ?? account.balance ?? "";
  const hidden = changes.hidden ?? account.hidden;

  async function save() {
    setBusy(true);
    const number = changes.balance?.replace(/\s/g, "").replace(",", ".");
    try {
      await engine.updateAccount(account.id, {
        ...(changes.label !== undefined ? { label: changes.label.trim() || account.label } : {}),
        ...(changes.hidden !== undefined ? { hidden: changes.hidden } : {}),
        // Picking the detected kind again goes back to following the source.
        ...(changes.kind !== undefined ? { kind: changes.kind === account.kind_detected ? "auto" : changes.kind } : {}),
        ...(changes.insurer !== undefined ? { insurer: changes.insurer.trim() } : {}),
        // An insurer only suggested so far is saved as the user's once they save.
        ...(changes.insurer === undefined && !account.insurer && account.insurer_suggested && INSURED_KINDS.has(kind)
          ? { insurer: account.insurer_suggested }
          : {}),
        ...(manual && number && Number.isFinite(Number(number)) ? { balance: number } : {}),
      });
      await refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("detail.deleteConfirm", { name: account.label }))) return;
    await engine.deleteAccount(account.id);
    await refresh();
    onClose();
  }

  return (
    <div className="account-editor form">
      <div className="row editor-fields">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor={`label-${account.id}`}>{t("detail.rename")}</label>
          <input id={`label-${account.id}`} className="input" value={label} onChange={(e) => change({ label: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`kind-${account.id}`}>{t("detail.kind")}</label>
          <select
            id={`kind-${account.id}`}
            className="input"
            value={kind}
            onChange={(e) => change({ kind: e.target.value as AccountKind })}
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </div>
        {INSURED_KINDS.has(kind) && (
          <div className="field" style={{ flex: 1.4 }}>
            <label htmlFor={`insurer-${account.id}`}>{t("detail.insurer")}</label>
            <input
              id={`insurer-${account.id}`}
              className="input"
              value={insurer}
              placeholder={t("detail.insurerUnknown")}
              onChange={(e) => change({ insurer: e.target.value })}
            />
          </div>
        )}
        {manual && (
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor={`balance-${account.id}`}>{t("detail.updateBalance")}</label>
            <input
              id={`balance-${account.id}`}
              className="input num"
              inputMode="decimal"
              value={balance}
              onChange={(e) => change({ balance: e.target.value })}
            />
          </div>
        )}
      </div>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <label className="checkbox">
          <input type="checkbox" checked={hidden} onChange={(e) => change({ hidden: e.target.checked })} />
          <span>{t("detail.exclude")}</span>
        </label>
        <span className="muted small">{t("detail.updated", { when: ago(account.updated_at) })}</span>
      </div>
      <div className="dialog-actions">
        {manual && (
          <button className="btn danger ghost" style={{ marginRight: "auto" }} onClick={() => void remove()}>
            {t("detail.delete")}
          </button>
        )}
        <button className="btn" onClick={onClose}>
          {t("add.cancel")}
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {t("detail.save")}
        </button>
      </div>
    </div>
  );
}
