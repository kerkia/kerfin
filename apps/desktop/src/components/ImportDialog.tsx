// Importing an account's transactions from a bank's CSV export (BoursoBank's, which also
// lists the accounts it aggregates): the file is read, the user confirms which of its
// accounts is this one, and its transactions are saved to it.
import { amount } from "@kerfin/core";
import type { Account, ImportAccount } from "@kerfin/core";
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

const plain = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** The file's account that is `account`: imported there before, else of the same name, else the only one. */
function guess(found: ImportAccount[], account: Account): string {
  const pick =
    found.find((a) => a.target === account.id) ??
    found.find((a) => plain(a.label) === plain(account.label)) ??
    (found.length === 1 ? found[0] : undefined);
  return pick?.number ?? "";
}

export function ImportDialog({ account, open, onClose }: { account: Account; open: boolean; onClose: () => void }) {
  const { refresh } = useData();
  const [data, setData] = useState<string | null>(null);
  const [found, setFound] = useState<ImportAccount[] | null>(null);
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setData(null);
    setFound(null);
    setError(null);
    setDone(null);
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
      setNumber(guess(accounts, account));
    } catch (e) {
      setError(e instanceof EngineError && e.code === "unreadable_export" ? t("import.unreadable") : t("import.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!data || !number) return;
    setBusy(true);
    try {
      const { imported } = await engine.importExport(data, { [number]: account.id });
      await refresh();
      setDone(imported);
    } catch {
      setError(t("import.failed"));
    } finally {
      setBusy(false);
    }
  }

  const chosen = found?.find((a) => a.number === number);
  return (
    <Dialog open={open} onClose={close}>
      <h2 style={{ margin: 0 }}>{t("import.title", { account: account.label })}</h2>
      {done !== null ? (
        <p className="secondary" style={{ margin: 0 }}>
          {t("import.done", { n: done, account: account.label })}
        </p>
      ) : !found ? (
        <>
          <p className="secondary" style={{ margin: 0 }}>
            {t("import.help")}
          </p>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void read(e.target.files?.[0])} />
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="import-account">{t("import.which", { account: account.label })}</label>
            <select id="import-account" className="input" value={number} onChange={(e) => setNumber(e.target.value)}>
              {!number && <option value="">{t("import.choose")}</option>}
              {found.map((a) => (
                <option key={a.number} value={a.number}>
                  {a.label} · {t("import.count", { n: a.count })}
                </option>
              ))}
            </select>
          </div>
          {chosen && (
            <p className="secondary" style={{ margin: 0 }}>
              {t("import.summary", {
                first: longDate(chosen.first),
                last: longDate(chosen.last),
                in: money(amount(chosen.income), "EUR", { maximumFractionDigits: 0 }),
                out: money(amount(chosen.spending), "EUR", { maximumFractionDigits: 0 }),
              })}
            </p>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            {account.connection_id ? t("import.replaceHelp") : `${t("import.replaceHelp")} ${t("import.balanceHelp")}`}
          </p>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={close}>
          {done !== null ? t("import.close") : t("add.cancel")}
        </button>
        {found && done === null && (
          <button className="btn primary" disabled={busy || !number} onClick={() => void save()}>
            {t("import.save")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
