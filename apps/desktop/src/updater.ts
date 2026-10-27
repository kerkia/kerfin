// Automatic updates from GitHub Releases, verified against the public key in tauri.conf.json.
import { isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";

import { stopEngine } from "./engine";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { kind: "unsupported" } // running in a browser during development
  | { kind: "idle" }
  | { kind: "available"; version: string }
  | { kind: "installing" }
  | { kind: "error"; message: string };

async function check(): Promise<Update | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

async function install(update: Update): Promise<void> {
  await update.download();
  // The engine's files are about to be replaced: it must not be running.
  await stopEngine();
  await update.install(); // on Windows the installer closes and restarts Kerfin
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/**
 * Checks at start and every few hours. `autoInstall` says whether installing right away
 * is harmless (nothing unlocked, nothing in progress); otherwise the user restarts.
 */
export function useUpdater(autoInstall: boolean) {
  const [state, setState] = useState<UpdateState>(isTauri() ? { kind: "idle" } : { kind: "unsupported" });
  const [update, setUpdate] = useState<Update | null>(null);

  const apply = useCallback(async (target: Update) => {
    setState({ kind: "installing" });
    try {
      await install(target);
    } catch (error) {
      setState({ kind: "error", message: String(error) });
    }
  }, []);

  const checkNow = useCallback(async () => {
    if (!isTauri()) return null;
    try {
      const found = await check();
      setUpdate(found);
      setState(found ? { kind: "available", version: found.version } : { kind: "idle" });
      return found;
    } catch (error) {
      setState({ kind: "error", message: String(error) });
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void checkNow();
    const timer = setInterval(() => void checkNow(), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [checkNow]);

  useEffect(() => {
    if (update && autoInstall && state.kind === "available") void apply(update);
  }, [update, autoInstall, state.kind, apply]);

  return {
    state,
    checkNow,
    installNow: () => (update ? apply(update) : Promise.resolve()),
  };
}
