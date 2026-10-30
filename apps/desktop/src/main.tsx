import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { initZoom } from "./zoom";

initZoom();

// The webview's own menu (back, reload, inspect...) has nothing to do in the app; text fields
// keep theirs for copy and paste. Kept while developing, for the inspector.
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("input, textarea, [contenteditable='true']")) event.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
