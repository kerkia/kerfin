// Adding accounts from a transactions file (BoursoBank's CSV export, which also lists the
// accounts it aggregates): each account in the file becomes a new account, goes into one
// Kerfin already has, or is left out; then its transactions are saved there.
import { amount } from "@kerfin/core";
import type { AccountKind, ImportAccount } from "@kerfin/core";
import { useState } from "react";

import { useData } from "../data";
import { EngineError, engine } from "../engine";
import { KIND_OPTIONS, kindLabel, longDate, money, t } from "../i18n";
import { base64 } from "./ImportDialog";

interface Choice {
  target: string; // "new", "skip" or an account id
  label: string; // a new account's name
  kind: AccountKind;
  institution: string;
}

export function ImportFile({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { overview, refresh } = useData();
  const [data, setData] = useState<string | null>(null);
  const [found, setFound] = useState<ImportAccount[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function read(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const encoded = await base64(file);
      const { accounts } = await engine.previewImport(encoded);
      setData(encoded);
      setFound(accounts);
      setChoices(
        Object.fromEntries(
          accounts.map((a) => [a.number, { target: a.target ?? "new", label: a.label, kind: a.kind, institution: a.institution }]),
        ),
      );
    } catch (e) {
      setError(e instanceof EngineError && e.code === "unreadable_export" ? t("import.unreadable") : t("import.failed"));
    } finally {
      setBusy(false);
    }
  }

  const choose = (number: string, change: Partial<Choice>) =>
    setChoices((all) => ({ ...all, [number]: { ...all[number]!, ...change } }));

  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      const entries = Object.entries(choices);
      await engine.importExport(
        data,
        Object.fromEntries(entries.map(([number, c]) => [number, c.target])),
        Object.fromEntries(
          entries
            .filter(([, c]) => c.target === "new")
            .map(([number, c]) => [number, { label: c.label.trim(), kind: c.kind, institution: c.institution.trim() }]),
        ),
      );
      await refresh();
      onDone();
    } catch {
      setError(t("import.failed"));
      setBusy(false);
    }
  }

  const accounts = (overview?.accounts ?? []).filter((a) => !a.hidden);
  const values = Object.values(choices);
  const invalid = values.every((c) => c.target === "skip") || values.some((c) => c.target === "new" && !c.label.trim());
  return (
    <>
      <h2 style={{ margin: 0 }}>{t("add.fileTitle")}</h2>
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
            {t("add.fileFound", { n: found.length })}
          </p>
          <div className="list">
            {found.map((account) => {
              const choice = choices[account.number]!;
              return (
                <div key={account.number} className="import-row">
                  <div>
                    <div>
                      <strong>{account.label}</strong>
                    </div>
                    <div className="muted small">
                      {t("import.count", { n: account.count })} · {longDate(account.first)} – {longDate(account.last)} ·{" "}
                      {t("add.fileInOut", {
                        in: money(amount(account.income), "EUR", { maximumFractionDigits: 0 }),
                        out: money(amount(account.spending), "EUR", { maximumFractionDigits: 0 }),
                      })}
                    </div>
                  </div>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <select
                      className="input compact"
                      aria-label={t("add.fileInto")}
                      value={choice.target}
                      onChange={(e) => choose(account.number, { target: e.target.value })}
                    >
                      <option value="new">{t("add.fileNew")}</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {t("add.fileExisting", { name: a.label })}
                        </option>
                      ))}
                      <option value="skip">{t("add.fileSkip")}</option>
                    </select>
                    {choice.target === "new" && (
                      <>
                        <input
                          className="input compact"
                          aria-label={t("add.accountName")}
                          value={choice.label}
                          maxLength={100}
                          onChange={(e) => choose(account.number, { label: e.target.value })}
                        />
                        <input
                          className="input compact"
                          aria-label={t("add.institution")}
                          title={t("add.institution")}
                          value={choice.institution}
                          maxLength={100}
                          onChange={(e) => choose(account.number, { institution: e.target.value })}
                        />
                        <select
                          className="input compact"
                          aria-label={t("add.kind")}
                          value={choice.kind}
                          onChange={(e) => choose(account.number, { kind: e.target.value as AccountKind })}
                        >
                          {KIND_OPTIONS.map((k) => (
                            <option key={k} value={k}>
                              {kindLabel(k)}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {t("add.fileHelp")}
          </p>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={onBack}>
          {t("add.back")}
        </button>
        {found && (
          <button className="btn primary" disabled={busy || invalid} onClick={() => void save()}>
            {t("import.save")}
          </button>
        )}
      </div>
    </>
  );
}
