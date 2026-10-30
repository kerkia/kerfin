// The period a budget page covers: the last months (counted with the current one), this year,
// last year, all the transactions, or dates the user picks. Each page remembers its own choice.
import { lastMonths } from "@kerfin/core";
import { useEffect, useState } from "react";

import { t } from "../i18n";

export const PRESETS = ["3", "6", "12", "year", "lastYear", "all", "custom"] as const;
export type Preset = (typeof PRESETS)[number];
export type Range = { from: string; to: string };

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a convenience only
  }
}

/** The period's dates; "all" starts with `first`, the earliest transaction's date. */
export function rangeOf(preset: Preset, today: string, custom: Range, first?: string | null): Range {
  const year = Number(today.slice(0, 4));
  if (preset === "year") return { from: `${year}-01-01`, to: today };
  if (preset === "lastYear") return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  if (preset === "all") return first && first < today ? { from: first.slice(0, 10), to: today } : lastMonths(today, 12);
  if (preset === "custom") return custom;
  return lastMonths(today, Number(preset));
}

/**
 * A date field that passes on whole dates only: typing a year goes through 0002, 0020 and
 * 0201 on its way to 2014, which are kept in the field and not passed on.
 */
function DateField({ value, label, min, max, onChange }: { value: string; label: string; min?: string; max?: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="date"
      className="input compact"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const year = Number(next.slice(0, 4));
        if (/^\d{4}-\d{2}-\d{2}$/.test(next) && year >= 1900 && year <= 2200) onChange(next);
      }}
      onBlur={() => setDraft(value)}
    />
  );
}

/** The period select, with start and end dates when the user picks dates. */
export function PeriodPicker({
  preset,
  custom,
  range,
  storageKey,
  onPreset,
  onCustom,
}: {
  preset: Preset;
  custom: Range;
  range: Range; // the period shown, which "Dates…" starts from
  storageKey: string;
  onPreset: (preset: Preset) => void;
  onCustom: (custom: Range) => void;
}) {
  return (
    <>
      <select
        className="input compact"
        aria-label={t("budget.period")}
        value={preset}
        onChange={(e) => {
          const value = e.target.value as Preset;
          if (value === "custom") onCustom(range);
          onPreset(value);
          remember(storageKey, value);
        }}
      >
        {PRESETS.map((p) => (
          <option key={p} value={p}>
            {t(`budget.range.${p}`, { n: p })}
          </option>
        ))}
      </select>
      {preset === "custom" && (
        <>
          <DateField
            label={t("budget.from")}
            value={custom.from}
            max={custom.to}
            onChange={(from) => onCustom({ ...custom, from })}
          />
          <span className="muted">–</span>
          <DateField label={t("budget.to")} value={custom.to} min={custom.from} onChange={(to) => onCustom({ ...custom, to })} />
        </>
      )}
    </>
  );
}
