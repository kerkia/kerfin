// A filter that keeps several values: a button naming the choice, and a checklist.
import { useEffect, useRef, useState } from "react";

import { t } from "../i18n";

export function MultiSelect({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string; // what is filtered, for screen readers and the "n selected" text
  allLabel: string; // shown when nothing is picked: no filter
  options: { value: string; label: string }[];
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const picked = options.filter((o) => selected.has(o.value));
  const summary =
    picked.length === 0 ? allLabel : picked.length === 1 ? picked[0]!.label : t("filter.count", { n: picked.length, what: label });

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <div className="multi-select" ref={root}>
      <button
        type="button"
        className={picked.length ? "input compact multi-button active" : "input compact multi-button"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        {summary}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="multi-menu" role="listbox" aria-multiselectable>
          {options.map((option) => (
            <label key={option.value} className="checkbox multi-option">
              <input type="checkbox" checked={selected.has(option.value)} onChange={() => toggle(option.value)} />
              <span>{option.label}</span>
            </label>
          ))}
          {picked.length > 0 && (
            <button type="button" className="btn small ghost" onClick={() => onChange(new Set())}>
              {t("filter.clear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
