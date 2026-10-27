// Tracks sync jobs: shows progress, asks the questions websites raise (SMS codes...),
// and reports how each one ended.
import type { Job } from "@kerfin/core";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { useData } from "../data";
import { engine } from "../engine";
import { errorText, t } from "../i18n";
import { Dialog, PromptInput, promptError } from "./ui";

interface Tracked {
  job: Job;
  name: string;
}

interface Toast {
  id: number;
  text: string;
  error: boolean;
}

const POLL_MS = 800;
const TOAST_MS = 8000;

const JobsContext = createContext<{ track: (job: Job, name: string) => void; active: boolean } | null>(null);

export function useJobs() {
  const jobs = useContext(JobsContext);
  if (!jobs) throw new Error("useJobs outside JobsProvider");
  return jobs;
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const { refresh } = useData();
  const [tracked, setTracked] = useState<Record<string, Tracked>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, error: boolean) => {
    const id = ++toastId.current;
    setToasts((all) => [...all, { id, text, error }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const finish = useCallback(
    (job: Job, name: string) => {
      setTracked(({ [job.id]: _, ...rest }) => rest);
      if (job.state === "done") toast(t("jobs.done", { name, n: job.accounts_found }), false);
      else if (job.state === "failed") toast(t("jobs.failed", { name, error: errorText(job.error?.code) }), true);
      else toast(t("jobs.cancelled", { name }), false);
      void refresh();
    },
    [refresh, toast],
  );

  const track = useCallback(
    (job: Job, name: string) => {
      setTracked((all) => ({ ...all, [job.id]: { job, name } }));
      const poll = async () => {
        let current = job;
        try {
          current = await engine.job(job.id);
        } catch {
          setTracked(({ [job.id]: _, ...rest }) => rest);
          return;
        }
        if (["done", "failed", "cancelled"].includes(current.state)) {
          finish(current, name);
        } else {
          setTracked((all) => ({ ...all, [job.id]: { job: current, name } }));
          setTimeout(poll, POLL_MS);
        }
      };
      setTimeout(poll, POLL_MS);
    },
    [finish],
  );

  const list = Object.values(tracked);
  const waiting = list.find((x) => x.job.state === "waiting" && x.job.prompt);

  return (
    <JobsContext.Provider value={{ track, active: list.length > 0 }}>
      {children}
      {waiting && <PromptDialog key={waiting.job.id + waiting.job.prompt!.key} tracked={waiting} />}
      <div className="tray" aria-live="polite">
        {list
          .filter((x) => x !== waiting)
          .map(({ job, name }) => (
            <div className="tray-item" key={job.id}>
              <div className="spinner" />
              <div>
                <div>{t("jobs.connecting", { name })}</div>
                {job.messages.length > 0 && (
                  <div className="secondary small">{job.messages[job.messages.length - 1]}</div>
                )}
              </div>
            </div>
          ))}
        {toasts.map((x) => (
          <div className="tray-item" key={x.id} role={x.error ? "alert" : "status"}>
            <span className={x.error ? "status error" : "status ok"} />
            <div>{x.text}</div>
          </div>
        ))}
      </div>
    </JobsContext.Provider>
  );
}

function PromptDialog({ tracked: { job, name } }: { tracked: Tracked }) {
  const prompt = job.prompt!;
  const [value, setValue] = useState(prompt.default ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (promptError(prompt, value)) return;
    setBusy(true);
    await engine.answer(job.id, value).catch(() => undefined);
  }

  return (
    <Dialog open onClose={() => void engine.cancel(job.id)}>
      <form className="form" onSubmit={send}>
        <h2>{t("jobs.needsInput", { name })}</h2>
        {job.messages.map((message, i) => (
          <p key={i} className="secondary" style={{ margin: 0 }}>
            {message}
          </p>
        ))}
        <PromptInput prompt={prompt} value={value} onChange={setValue} showError={submitted} autoFocus />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => void engine.cancel(job.id)}>
            {t("jobs.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {t("jobs.send")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Re-renders every minute, so relative times ("5 min ago") stay right. */
export function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
}
