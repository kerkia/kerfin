import { INSURED_KINDS, accountInsurer, amount } from "@kerfin/core";
import type { Account, AccountKind, Holding, Transaction } from "@kerfin/core";
import { useEffect, useState } from "react";

import { useData } from "../data";
import { engine } from "../engine";
import { KIND_OPTIONS, ago, kindLabel, longDate, money, t } from "../i18n";
import { Dialog } from "./ui";

export function AccountDetail({ account, onClose }: { account: Account | null; onClose: () => void }) {
  return (
    <Dialog open={!!account} onClose={onClose} wide>
      {account && <Detail key={account.id} account={account} onClose={onClose} />}
    </Dialog>
  );
}

function Detail({ account, onClose }: { account: Account; onClose: () => void }) {
  const { refresh, accountInstitution } = useData();
  const [detail, setDetail] = useState<{ holdings: Holding[]; transactions: Transaction[] } | null>(null);
  const [label, setLabel] = useState(account.label);
  const [hidden, setHidden] = useState(account.hidden);
  const [balance, setBalance] = useState(account.balance ?? "");
  const [kind, setKind] = useState<AccountKind>(account.kind);
  // Filled in from the contract's name when the user hasn't set it: editable like any value.
  const [insurer, setInsurer] = useState(account.insurer ?? account.insurer_suggested ?? "");
  const manual = !account.connection_id;
  const currency = account.currency ?? "EUR";

  useEffect(() => {
    engine.accountDetail(account.id).then(setDetail, () => undefined);
  }, [account.id]);

  async function save() {
    const number = balance.replace(/\s/g, "").replace(",", ".");
    await engine.updateAccount(account.id, {
      label: label.trim() || account.label,
      hidden,
      // Picking the detected kind again goes back to following the source.
      ...(kind !== account.kind ? { kind: kind === account.kind_detected ? "auto" : kind } : {}),
      ...(insurer.trim() !== (account.insurer ?? "") ? { insurer: insurer.trim() } : {}),
      ...(manual && number !== account.balance && Number.isFinite(Number(number)) ? { balance: number } : {}),
    });
    await refresh();
    onClose();
  }

  async function remove() {
    if (!window.confirm(t("detail.deleteConfirm", { name: account.label }))) return;
    await engine.deleteAccount(account.id);
    await refresh();
    onClose();
  }

  return (
    <>
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div>
          <h2>{account.label}</h2>
          <div className="muted small">
            {accountInstitution(account)} · {kindLabel(account.kind)}
            {accountInsurer(account) ? ` · ${t("detail.insuredBy", { insurer: accountInsurer(account)! })}` : ""}
            {account.number ? ` · ${account.number}` : ""} · {t("detail.updated", { when: ago(account.updated_at) })}
          </div>
        </div>
        <div className="hero-value" style={{ fontSize: 28, margin: 0 }}>
          {account.balance == null ? "–" : money(amount(account.balance), currency)}
        </div>
      </div>

      {detail && detail.holdings.length > 0 && (
        <section>
          <h2 style={{ marginBottom: 6 }}>{t("detail.holdings")}</h2>
          <table className="table">
            <thead>
              <tr>
                <th />
                <th className="right">{t("detail.quantity")}</th>
                <th className="right">{t("detail.value")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.holdings.map((h, i) => (
                <tr key={i}>
                  <td>
                    {h.label}
                    {h.isin && <div className="muted small">{h.isin}</div>}
                  </td>
                  <td className="right num">{h.quantity ? amount(h.quantity).toLocaleString("en-GB") : "–"}</td>
                  <td className="right num">{h.valuation ? money(amount(h.valuation), h.currency ?? currency) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {detail && detail.transactions.length > 0 && (
        <section>
          <h2 style={{ marginBottom: 6 }}>{t("detail.transactions")}</h2>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            <table className="table">
              <tbody>
                {detail.transactions.map((tx, i) => (
                  <tr key={i}>
                    <td className="muted num" style={{ width: 110 }}>
                      {longDate(tx.date)}
                    </td>
                    <td>{tx.label}</td>
                    <td className="right num">{money(amount(tx.amount), tx.currency ?? currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detail && !manual && detail.holdings.length + detail.transactions.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {t("detail.none")}
        </p>
      )}

      <section className="form" style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="d-label">{t("detail.rename")}</label>
            <input id="d-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          {manual && (
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="d-balance">{t("detail.updateBalance")}</label>
              <input
                id="d-balance"
                className="input num"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="d-kind">{t("detail.kind")}</label>
            <select id="d-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </div>
          {INSURED_KINDS.has(kind) && (
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="d-insurer">{t("detail.insurer")}</label>
              <input
                id="d-insurer"
                className="input"
                value={insurer}
                placeholder={t("detail.insurerUnknown")}
                onChange={(e) => setInsurer(e.target.value)}
              />
            </div>
          )}
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          <span>{t("detail.exclude")}</span>
        </label>
        <div className="dialog-actions">
          {manual && (
            <button className="btn danger ghost" style={{ marginRight: "auto" }} onClick={() => void remove()}>
              {t("detail.delete")}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t("add.cancel")}
          </button>
          <button className="btn primary" onClick={() => void save()}>
            {t("detail.save")}
          </button>
        </div>
      </section>
    </>
  );
}
