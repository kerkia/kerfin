// The period a budget page covers: the last months (counted with the current one), this year,
// last year, or dates the user picks. Each page remembers its own choice.
import { lastMonths } from "@kerfin/core";

import { t } from "../i18n";

export const PRESETS = ["3", "6", "12", "year", "lastYear", "custom"] as const;
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

export function rangeOf(preset: Preset, today: string, custom: Range): Range {
  const year = Number(today.slice(0, 4));
  if (preset === "year") return { from: `${year}-01-01`, to: today };
  if (preset === "lastYear") return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  if (preset === "custom") return custom;
  return lastMonths(today, Number(preset));
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
          <input
            type="date"
            className="input compact"
            aria-label={t("budget.from")}
            value={custom.from}
            max={custom.to}
            onChange={(e) => e.target.value && onCustom({ ...custom, from: e.target.value })}
          />
          <span className="muted">–</span>
          <input
            type="date"
            className="input compact"
            aria-label={t("budget.to")}
            value={custom.to}
            min={custom.from}
            onChange={(e) => e.target.value && onCustom({ ...custom, to: e.target.value })}
          />
        </>
      )}
    </>
  );
}
