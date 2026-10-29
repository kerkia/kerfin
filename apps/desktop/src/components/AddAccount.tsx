// Adding accounts: from a bank's transactions file, by hand, or by connecting Finary (which
// brings in the accounts linked there).
import type { Connection, Institution, Prompt } from "@kerfin/core";
import { useEffect, useState } from "react";

import { useData } from "../data";
import { EngineError, engine } from "../engine";
import { KIND_OPTIONS, errorText, kindLabel, t } from "../i18n";
import { FinaryConnect } from "./FinaryConnect";
import { ImportFile } from "./ImportFile";
import { useJobs } from "./Jobs";
import { Dialog, PromptInput, initialValues, promptError } from "./ui";

type Step =
  | { kind: "pick" }
  | { kind: "finary" }
  | { kind: "connect"; institution: Institution }
  | { kind: "manual"; name: string }
  | { kind: "file" };

export function AddAccount({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const close = () => {
    setStep({ kind: "pick" });
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} wide={step.kind === "file"}>
      {step.kind === "pick" && <Pick onPick={setStep} onCancel={close} />}
      {step.kind === "finary" && <FinaryConnect onBack={() => setStep({ kind: "pick" })} onDone={close} />}
      {step.kind === "connect" && (
        <ConnectForm institution={step.institution} onBack={() => setStep({ kind: "pick" })} onDone={close} />
      )}
      {step.kind === "file" && <ImportFile onBack={() => setStep({ kind: "pick" })} onDone={close} />}
      {step.kind === "manual" && (
        <ManualForm name={step.name} onBack={() => setStep({ kind: "pick" })} onDone={close} />
      )}
    </Dialog>
  );
}

function Pick({ onPick, onCancel }: { onPick: (step: Step) => void; onCancel: () => void }) {
  const { institutions, overview } = useData();
  const finaryConnected = (overview?.connections ?? []).some((c) => c.institution === "finary");
  // Other connections still offered (the demo bank while developing).
  const others = institutions.filter((i) => i.offered && i.connector !== "finary" && i.implemented);

  return (
    <>
      <h2>{t("add.title")}</h2>
      <div className="list">
        <button className="list-row" onClick={() => onPick({ kind: "file" })}>
          <span>
            <div>{t("add.file")}</div>
            <div className="muted small">{t("add.fileHint")}</div>
          </span>
        </button>
        <button className="list-row" onClick={() => onPick({ kind: "manual", name: "" })}>
          <span>
            <div>{t("add.byHand")}</div>
            <div className="muted small">{t("add.byHandHint")}</div>
          </span>
        </button>
        <button className="list-row" onClick={() => onPick({ kind: "finary" })}>
          <span>
            <div>{finaryConnected ? t("add.finaryAnother") : t("add.finary")}</div>
            <div className="muted small">{finaryConnected ? t("add.finaryAnotherHint") : t("add.finaryHint")}</div>
          </span>
        </button>
        {others.map((institution) => (
          <button key={institution.id} className="list-row" onClick={() => onPick({ kind: "connect", institution })}>
            <span>
              <div>{t("add.connectTitle", { name: institution.name })}</div>
              <div className="muted small">{institution.products}</div>
            </span>
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <button className="btn" onClick={onCancel}>
          {t("add.cancel")}
        </button>
      </div>
    </>
  );
}

/** Login form for a connected institution; also used to update an existing connection's login. */
export function ConnectForm({
  institution,
  connection,
  onBack,
  onDone,
}: {
  institution: Institution;
  connection?: Connection;
  onBack: () => void;
  onDone: () => void;
}) {
  const { track } = useJobs();
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState(connection?.label ?? institution.name);
  const [remember, setRemember] = useState(connection?.remember_secrets ?? true);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedParams = connection?.params;
  useEffect(() => {
    engine.fields(institution.id).then(
      (fields) => {
        setPrompts(fields);
        setValues({ ...initialValues(fields), ...savedParams });
      },
      (e: EngineError) => setError(errorText(e.code)),
    );
    // Only on open: a refresh of the connection list must not wipe what the user typed.
  }, [institution.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!prompts || prompts.some((p) => promptError(p, values[p.key] ?? ""))) return;
    setError(null);
    try {
      const job = connection
        ? await engine.updateCredentials(connection.id, values, remember)
        : (await engine.addConnection(institution.id, label, values, remember)).job;
      track(job, label || institution.name);
      onDone();
    } catch (e) {
      setError(e instanceof EngineError ? errorText(e.code) : String(e));
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2>{t("add.connectTitle", { name: institution.name })}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t("add.covers", { products: institution.products })}
      </p>
      {!prompts && !error && <div className="spinner" aria-label={t("add.loadingFields")} />}
      {prompts?.map((prompt, i) => (
        <PromptInput
          key={prompt.key}
          prompt={prompt}
          value={values[prompt.key] ?? ""}
          onChange={(value) => setValues((all) => ({ ...all, [prompt.key]: value }))}
          showError={submitted}
          autoFocus={i === 0}
        />
      ))}
      {prompts && !connection && (
        <div className="field">
          <label htmlFor="connection-label">{t("add.label")}</label>
          <input id="connection-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      )}
      {prompts && (
        <label className="checkbox">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>
            {t("add.remember")}
            <div className="muted small">{t("add.rememberHint")}</div>
          </span>
        </label>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {t("add.privacy", { name: institution.name })}
      </p>
      {error && <div className="error-text">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onBack}>
          {connection ? t("add.cancel") : t("add.back")}
        </button>
        <button type="submit" className="btn primary" disabled={!prompts}>
          {t("add.submit")}
        </button>
      </div>
    </form>
  );
}

function ManualForm({ name, onBack, onDone }: { name: string; onBack: () => void; onDone: () => void }) {
  const { refresh } = useData();
  const [institution, setInstitution] = useState(name);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("life_insurance");
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [error, setError] = useState<string | null>(null);

  const number = balance.replace(/\s/g, "").replace(",", ".");
  const valid = institution.trim() && label.trim() && number !== "" && Number.isFinite(Number(number));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    try {
      await engine.addManualAccount({
        institution_name: institution.trim(),
        label: label.trim(),
        kind,
        balance: number,
        currency: currency.trim().toUpperCase() || "EUR",
      });
      await refresh();
      onDone();
    } catch (e) {
      setError(e instanceof EngineError ? errorText(e.code) : String(e));
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2>{t("add.manualTitle")}</h2>
      <div className="field">
        <label htmlFor="m-institution">{t("add.institution")}</label>
        <input id="m-institution" className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="m-label">{t("add.accountName")}</label>
        <input id="m-label" className="input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="m-kind">{t("add.kind")}</label>
        <select id="m-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="field" style={{ flex: 3 }}>
          <label htmlFor="m-balance">{t("add.balance")}</label>
          <input id="m-balance" className="input num" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="m-currency">{t("add.currency")}</label>
          <input id="m-currency" className="input" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onBack}>
          {t("add.back")}
        </button>
        <button type="submit" className="btn primary" disabled={!valid}>
          {t("add.save")}
        </button>
      </div>
    </form>
  );
}
