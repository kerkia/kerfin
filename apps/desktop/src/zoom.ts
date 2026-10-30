// The window's zoom: steps in and out with the status bar's buttons or Ctrl+= / Ctrl+- / Ctrl+0,
// remembered on this computer. In the app the webview itself zooms; in a browser while
// developing, the page does.
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export const ZOOM_LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const KEY = "kerfin.zoom";

function storedZoom(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return ZOOM_LEVELS.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

async function apply(level: number) {
  if (isTauri()) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(level);
  } else {
    document.documentElement.style.zoom = level === 1 ? "" : String(level);
  }
}

/** Applies the zoom remembered, before the first screen shows. */
export function initZoom() {
  const level = storedZoom();
  if (level !== 1) void apply(level).catch(() => undefined);
}

export function useZoom() {
  const [zoom, setZoom] = useState(storedZoom);

  const set = useCallback((level: number) => {
    setZoom(level);
    try {
      localStorage.setItem(KEY, String(level));
    } catch {
      // a convenience only
    }
    void apply(level).catch(() => undefined);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      const index = ZOOM_LEVELS.findIndex((level) => level >= zoom);
      const next = ZOOM_LEVELS[Math.min(Math.max((index < 0 ? ZOOM_LEVELS.length - 1 : index) + direction, 0), ZOOM_LEVELS.length - 1)]!;
      set(next);
    },
    [zoom, set],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key === "=" || event.key === "+" || event.code === "NumpadAdd") step(1);
      else if (event.key === "-" || event.code === "NumpadSubtract") step(-1);
      else if (event.key === "0" || event.code === "Numpad0") set(1);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, set]);

  return { zoom, zoomIn: () => step(1), zoomOut: () => step(-1), reset: () => set(1) };
}
