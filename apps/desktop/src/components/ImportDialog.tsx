// Importing a bank's CSV export (BoursoBank's, which includes the accounts it aggregates):
// the file is read, each account in it shown with where its transactions will go, then saved.
import { amount } from "@kerfin/core";
import type { ImportAccount } from "@kerfin/core";
import { useState } from "react";

import { useData } from "../data";
import { EngineError, engine } from "../engine";
import { longDate, money, t } from "../i18n";
import { Dialog } from "./ui";

/** The file's bytes as base64, for the engine to decode whatever the file's encoding. */
async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { overview, refresh } = useData();
  const [data, setData] = useState<string | null>(null);
  const [found, setFound] = useState<ImportAccount[] | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setData(null);
    setFound(null);
    setError(null);
    onClose();
  }

  async function read(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const encoded = await base64(file);
      const { accounts } = await engine.previewImport(encoded);
      setData(encoded);
      setFound(accounts);
      setTargets(Object.fromEntries(accounts.map((a) => [a.number, a.target ?? "new"])));
    } catch (e) {
      setError(e instanceof EngineError && e.code === "unreadable_export" ? t("import.unreadable") : t("import.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      await engine.importExport(data, targets);
      await refresh();
      onImported();
      close();
    } catch {
      setError(t("import.failed"));
    } finally {
      setBusy(false);
    }
  }

  const accounts = (overview?.accounts ?? []).filter((a) => !a.hidden);
  return (
    <Dialog open={open} onClose={close} wide>
      <h2 style={{ margin: 0 }}>{t("import.title")}</h2>
      {!found ? (
        <>
          <p className="secondary" style={{ margin: 0 }}>
            {t("import.help")}
          </p>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void read(e.target.files?.[0])} />
        </>
      ) : (
        <>
          <p className="secondary" style={{ margin: 0 }}>
            {t("import.found", { n: found.length })}
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("import.account")}</th>
                  <th>{t("import.period")}</th>
                  <th className="right">{t("import.in")}</th>
                  <th className="right">{t("import.out")}</th>
                  <th>{t("import.into")}</th>
                </tr>
              </thead>
              <tbody>
                {found.map((account) => (
                  <tr key={account.number}>
                    <td>
                      <div>{account.label}</div>
                      <div className="muted small">{t("import.count", { n: account.count })}</div>
                    </td>
                    <td className="small">
                      {longDate(account.first)} – {longDate(account.last)}
                    </td>
                    <td className="right num">{money(amount(account.income), "EUR", { maximumFractionDigits: 0 })}</td>
                    <td className="right num">{money(amount(account.spending), "EUR", { maximumFractionDigits: 0 })}</td>
                    <td>
                      <select
                        className="input compact"
                        aria-label={t("import.into")}
                        value={targets[account.number] ?? "new"}
                        onChange={(e) => setTargets((all) => ({ ...all, [account.number]: e.target.value }))}
                      >
                        <option value="new">{t("import.new")}</option>
                        <option value="skip">{t("import.skip")}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {t("import.replaceHelp")}
          </p>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={close}>
          {t("add.cancel")}
        </button>
        {found && (
          <button className="btn primary" disabled={busy || Object.values(targets).every((v) => v === "skip")} onClick={() => void save()}>
            {t("import.save")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
