// A page's choices (filters, sorting) kept through locking, restarts and updates: in the
// vault, for filters name payees, institutions and insurers.
import { useEffect, useRef, useState } from "react";

import { engine } from "./engine";

type View = Record<string, string | boolean | string[]>;

/** The saved values that still fit the page: those of `fallback`'s keys, of the same type. */
function fitting<T extends View>(saved: unknown, fallback: T): Partial<T> {
  if (!saved || typeof saved !== "object") return {};
  const fit = Object.entries(saved).filter(([key, value]) => {
    const expected = fallback[key];
    if (expected === undefined) return false;
    if (Array.isArray(expected)) return Array.isArray(value) && value.every((item) => typeof item === "string");
    return typeof value === typeof expected;
  });
  return Object.fromEntries(fit) as Partial<T>;
}

/**
 * The page's saved view, `fallback` until it is loaded, and a function changing some of it,
 * which saves it.
 */
export function useSavedView<T extends View>(name: string, fallback: T): [T, (change: Partial<T>) => void] {
  const [view, setView] = useState<T>(fallback);
  const saved = useRef<string | null>(null); // as last loaded or saved; null until loaded

  useEffect(() => {
    let live = true;
    engine.views().then(
      (views) => {
        if (!live) return;
        const next = { ...fallback, ...fitting(views[name], fallback) };
        saved.current = JSON.stringify(next);
        setView(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // The fallback is a fresh object each render: loaded once per page.
  }, [name]);

  useEffect(() => {
    const json = JSON.stringify(view);
    // Not before it is loaded, which would save the fallback over it.
    if (saved.current === null || json === saved.current) return;
    saved.current = json;
    engine.saveView(name, view).catch(() => undefined);
  }, [name, view]);

  return [view, (change) => setView((current) => ({ ...current, ...change }))];
}
