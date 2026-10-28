// The only way the UI reaches data. A future web version swaps this module for one that
// reads synced, end-to-end encrypted data instead of a local engine.
import type {
  EngineStatus,
  FinarySignInStatus,
  Holding,
  Institution,
  Job,
  Overview,
  Prompt,
  Transaction,
} from "@kerfin/core";
import { invoke, isTauri } from "@tauri-apps/api/core";

export class EngineError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail = "",
  ) {
    super(detail || code);
  }
}

interface EngineInfo {
  url: string;
  token: string;
}

let info: Promise<EngineInfo> | null = null;

function engineInfo(): Promise<EngineInfo> {
  info ??= isTauri()
    ? invoke<EngineInfo>("engine_info")
    : Promise.resolve({
        // `npm run dev` in a browser, against `kerfin-engine serve` (see apps/desktop/README.md).
        url: import.meta.env.VITE_ENGINE_URL ?? "http://127.0.0.1:8765",
        token: import.meta.env.VITE_ENGINE_TOKEN ?? "dev",
      });
  info.catch(() => (info = null));
  return info;
}

const lockListeners = new Set<() => void>();

/** Called when a request finds the vault locked (e.g. after the idle timeout). */
export function onLocked(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    const { url, token } = await engineInfo();
    response = await fetch(url + path, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new EngineError(0, "engine_unreachable", String(error));
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 423) lockListeners.forEach((listener) => listener());
    throw new EngineError(response.status, data?.error?.code ?? "unexpected", data?.error?.detail ?? "");
  }
  return data as T;
}

export const engine = {
  status: () => call<EngineStatus>("GET", "/api/status"),
  createVault: (passphrase: string) => call<EngineStatus>("POST", "/api/vault/create", { passphrase }),
  unlock: (passphrase: string) => call<EngineStatus>("POST", "/api/vault/unlock", { passphrase }),
  lock: () => call<EngineStatus>("POST", "/api/vault/lock"),

  institutions: () => call<Institution[]>("GET", "/api/institutions"),
  fields: (institution: string) => call<Prompt[]>("GET", `/api/institutions/${institution}/fields`),
  overview: () => call<Overview>("GET", "/api/overview"),

  addConnection: (institution: string, label: string, values: Record<string, string>, remember: boolean) =>
    call<{ connection_id: string; job: Job }>("POST", "/api/connections", {
      institution,
      label,
      values,
      remember,
    }),
  updateCredentials: (id: string, values: Record<string, string>, remember: boolean) =>
    call<Job>("PUT", `/api/connections/${id}/credentials`, { values, remember }),
  sync: (id: string) => call<Job>("POST", `/api/connections/${id}/sync`),
  syncAll: () => call<Job[]>("POST", "/api/sync"),
  removeConnection: (id: string) => call<object>("DELETE", `/api/connections/${id}`),
  /** Starts signing in to Finary in `browser`; `connectionId` to sign in again. */
  finarySignIn: (browser: string, connectionId?: string) =>
    call<{ url: string }>("POST", "/api/finary/sign-in", { connection_id: connectionId, browser }),
  browsers: () => call<{ browsers: { id: string; name: string }[]; selected: string }>("GET", "/api/browsers"),
  finarySignInStatus: () => call<FinarySignInStatus>("GET", "/api/finary/sign-in"),

  job: (id: string) => call<Job>("GET", `/api/jobs/${id}`),
  answer: (id: string, value: string) => call<Job>("POST", `/api/jobs/${id}/answer`, { value }),
  cancel: (id: string) => call<Job>("POST", `/api/jobs/${id}/cancel`),

  addManualAccount: (account: {
    institution_name: string;
    label: string;
    kind: string;
    balance: string;
    currency: string;
  }) => call<{ id: string }>("POST", "/api/accounts", account),
  accountDetail: (id: string) =>
    call<{ holdings: Holding[]; transactions: Transaction[] }>("GET", `/api/accounts/${id}`),
  updateAccount: (id: string, changes: { label?: string; hidden?: boolean; balance?: string }) =>
    call<object>("PATCH", `/api/accounts/${id}`, changes),
  deleteAccount: (id: string) => call<object>("DELETE", `/api/accounts/${id}`),

  setAutoLock: (minutes: number) =>
    call<EngineStatus>("PUT", "/api/settings", { auto_lock_minutes: minutes }),
};

/** Stops the engine so an update can replace its files (desktop app only). */
export async function stopEngine(): Promise<void> {
  if (isTauri()) await invoke("stop_engine");
}
