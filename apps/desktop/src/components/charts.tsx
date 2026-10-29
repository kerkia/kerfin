import type { HistoryPoint, Slice } from "@kerfin/core";
import { useEffect, useRef, useState } from "react";

import { compactMoney, longDate, money, percent, shortDate } from "../i18n";

/** Props making rows pickable: clicking one selects it (a filter), clicking it again clears. */
interface Pickable {
  selected?: string | null;
  onSelect?: (key: string) => void;
}

/** A row's props when the list is pickable: a keyboard-reachable toggle. */
function pickProps(key: string, { selected, onSelect }: Pickable, base: string) {
  if (!onSelect) return { className: base };
  const state = selected === key ? " selected" : selected ? " dimmed" : "";
  return {
    className: `${base} pickable${state}`,
    tabIndex: 0,
    "aria-pressed": selected === key,
    onClick: () => onSelect(key),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(key);
      }
    },
  };
}

/** Ranked horizontal bars, one hue: each row is a category's share of the total. */
export function BarList({
  slices,
  label,
  sharesOnly,
  format = (value: number) => money(value, "EUR", { maximumFractionDigits: 0 }),
  selected,
  onSelect,
}: {
  slices: Slice[];
  label: (key: string) => string;
  sharesOnly?: boolean; // percentages without amounts
  format?: (value: number) => string; // the values, when not euros
} & Pickable) {
  const max = Math.max(...slices.map((s) => s.value), 1);
  return (
    <div className="bar-list" role="table">
      {slices.map((slice) => (
        <div
          {...pickProps(slice.key, { selected, onSelect }, "bar-item")}
          role={onSelect ? "button" : "row"}
          key={slice.key}
          title={`${label(slice.key)}: ${format(slice.value)} (${percent(slice.share)})`}
        >
          <span role="cell" className="secondary" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {label(slice.key)}
          </span>
          <span className="bar-track" aria-hidden>
            <span className="bar" style={{ width: `${(slice.value / max) * 100}%` }} />
          </span>
          <span role="cell" className="num small">
            {!sharesOnly && <>{format(slice.value)} </>}
            <span className={sharesOnly ? undefined : "muted"}>{percent(slice.share)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 26, left: 56 };

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** Single-series line with an area wash, a crosshair and a tooltip. */
export function LineChart({ series, currency = "EUR" }: { series: HistoryPoint[]; currency?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const times = series.map((p) => new Date(p.date).getTime());
  const t0 = times[0]!;
  const t1 = times[times.length - 1]!;
  const values = series.map((p) => p.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A wealth line moves by a few percent: an axis from zero would flatten it. The area wash
  // only shows when the axis starts at zero, where its height means something.
  const fromZero = low <= 0 || (high - low) / high > 0.5;
  const ticks = niceTicks(fromZero ? Math.min(low, 0) : low, high);
  const yMin = ticks[0]!;
  const yMax = ticks[ticks.length - 1]!;
  const innerW = Math.max(width - PAD.left - PAD.right, 10);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + (t1 === t0 ? innerW : ((time - t0) / (t1 - t0)) * innerW);
  const y = (value: number) => PAD.top + innerH - ((value - yMin) / (yMax - yMin || 1)) * innerH;

  const line = series.map((p, i) => `${i ? "L" : "M"}${x(times[i]!)},${y(p.value)}`).join("");
  const area = `${line}L${x(t1)},${y(yMin)}L${x(t0)},${y(yMin)}Z`;
  const dateTicks = [0, Math.floor((series.length - 1) / 2), series.length - 1].filter(
    (v, i, all) => all.indexOf(v) === i,
  );

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    let best = 0;
    times.forEach((time, i) => {
      if (Math.abs(x(time) - px) < Math.abs(x(times[best]!) - px)) best = i;
    });
    setHover(best);
  }

  const last = series.length - 1;
  const focus = hover ?? last;
  const point = series[focus]!;

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg
        className="chart-svg"
        width={width}
        height={HEIGHT}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={series.map((p) => `${p.date}: ${money(p.value, currency)}`).join(", ")}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
              {compactMoney(tick, currency)}
            </text>
          </g>
        ))}
        {dateTicks.map((i) => (
          <text
            key={i}
            x={x(times[i]!)}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
          >
            {shortDate(series[i]!.date)}
          </text>
        ))}
        {fromZero && <path d={area} fill="var(--accent)" opacity={0.1} />}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <line
            x1={x(times[focus]!)}
            x2={x(times[focus]!)}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="var(--axis)"
          />
        )}
        <circle
          cx={x(times[focus]!)}
          cy={y(point.value)}
          r={4}
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth={2}
        />
      </svg>
      {hover !== null && (
        <div
          className="tooltip"
          style={{
            left: Math.min(x(times[focus]!) + 10, width - 170),
            top: Math.max(y(point.value) - 48, 0),
          }}
        >
          <div className="muted">{longDate(point.date)}</div>
          <div className="num">{money(point.value, currency)}</div>
        </div>
      )}
    </div>
  );
}

const COLUMN_HEIGHT = 180;
const COLUMN_PAD = { top: 12, right: 8, bottom: 24, left: 52 };

/**
 * One column per period, one hue, anchored on a zero baseline, with a tooltip per column.
 * `label` names a column under the axis; `title` names it in the tooltip.
 */
export function ColumnChart({
  columns,
  label,
  title,
}: {
  columns: { key: string; value: number }[];
  label: (key: string) => string;
  title: (key: string) => string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const ticks = niceTicks(0, Math.max(...columns.map((c) => c.value), 1));
  const yMax = ticks[ticks.length - 1]!;
  const innerW = Math.max(width - COLUMN_PAD.left - COLUMN_PAD.right, 10);
  const innerH = COLUMN_HEIGHT - COLUMN_PAD.top - COLUMN_PAD.bottom;
  const slot = innerW / Math.max(columns.length, 1);
  const barW = Math.max(Math.min(slot * 0.6, 36), 4);
  const y = (value: number) => COLUMN_PAD.top + innerH - (value / yMax) * innerH;
  const focus = hover === null ? null : columns[hover];

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg
        className="chart-svg"
        width={width}
        height={COLUMN_HEIGHT}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={columns.map((c) => `${title(c.key)}: ${money(c.value)}`).join(", ")}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={COLUMN_PAD.left} x2={width - COLUMN_PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" />
            <text x={COLUMN_PAD.left - 8} y={y(tick) + 4} textAnchor="end">
              {compactMoney(tick)}
            </text>
          </g>
        ))}
        {columns.map((column, i) => {
          const x = COLUMN_PAD.left + slot * i + (slot - barW) / 2;
          const top = y(column.value);
          const height = COLUMN_PAD.top + innerH - top;
          const radius = Math.min(4, height / 2, barW / 2);
          // Rounded at the data end only; square on the baseline.
          const path =
            height > 0
              ? `M${x},${top + height}V${top + radius}Q${x},${top} ${x + radius},${top}H${x + barW - radius}` +
                `Q${x + barW},${top} ${x + barW},${top + radius}V${top + height}Z`
              : "";
          return (
            <g key={column.key} onMouseEnter={() => setHover(i)}>
              {/* The hit area spans the whole slot, taller than the column. */}
              <rect x={COLUMN_PAD.left + slot * i} y={COLUMN_PAD.top} width={slot} height={innerH} fill="transparent" />
              {path && <path d={path} fill="var(--accent)" opacity={hover === null || hover === i ? 1 : 0.55} />}
              <text x={x + barW / 2} y={COLUMN_HEIGHT - 6} textAnchor="middle">
                {label(column.key)}
              </text>
            </g>
          );
        })}
      </svg>
      {focus && hover !== null && (
        <div
          className="tooltip"
          style={{
            left: Math.min(COLUMN_PAD.left + slot * hover + slot / 2 + 8, width - 160),
            top: Math.max(y(focus.value) - 52, 0),
          }}
        >
          <div className="muted">{title(focus.key)}</div>
          <div className="num">{money(focus.value, "EUR", { maximumFractionDigits: 0 })}</div>
        </div>
      )}
    </div>
  );
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  share: number; // 0..1
  color: string; // a CSS color, e.g. var(--series-1)
}

const DONUT_SIZE = 200;
const DONUT_RING = 22;
const MAX_SLICES = 6; // part-to-whole reads at a glance up to about six segments

/**
 * The largest `MAX_SLICES - 1` items keep their own color, in a fixed order; the rest fold
 * into "Other". Colors follow the item, so a filter never repaints the survivors.
 */
export function donutSlices(items: { key: string; label: string; value: number }[], otherLabel: string): DonutSlice[] {
  const positive = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((sum, item) => sum + item.value, 0) || 1;
  const kept = positive.length > MAX_SLICES ? positive.slice(0, MAX_SLICES - 1) : positive;
  const rest = positive.slice(kept.length);
  // Keys starting with "__" (e.g. "insurer not set") are not entities: grey, like "Other".
  let slot = 0;
  const slices = kept.map((item) => ({
    ...item,
    share: item.value / total,
    color: item.key.startsWith("__") ? "var(--series-other)" : `var(--series-${++slot})`,
  }));
  if (rest.length) {
    const value = rest.reduce((sum, item) => sum + item.value, 0);
    slices.push({ key: "__other", label: otherLabel, value, share: value / total, color: "var(--series-other)" });
  }
  return slices;
}

function arc(start: number, end: number, radius: number): string {
  const center = DONUT_SIZE / 2;
  const point = (angle: number) => [center + radius * Math.sin(angle), center - radius * Math.cos(angle)];
  const [x0, y0] = point(start);
  const [x1, y1] = point(end);
  return `M${x0},${y0}A${radius},${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
}

/** Part-to-whole ring with the total in its center and a tooltip per segment. */
export function Donut({
  slices,
  total,
  totalLabel,
  active,
  onActive,
  onSelect,
}: {
  slices: DonutSlice[];
  total: string;
  totalLabel: string;
  active: string | null;
  onActive: (key: string | null) => void;
  onSelect?: (key: string) => void;
}) {
  const radius = (DONUT_SIZE - DONUT_RING) / 2;
  // A 2px gap between segments, measured along the ring.
  const gap = slices.length > 1 ? 2 / radius : 0;
  let angle = 0;
  const focus = slices.find((s) => s.key === active);
  return (
    <div className="donut" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
      <svg width={DONUT_SIZE} height={DONUT_SIZE} role="img" aria-label={slices.map((s) => `${s.label} ${percent(s.share)}`).join(", ")}>
        {slices.map((slice) => {
          const start = angle;
          angle += slice.share * 2 * Math.PI;
          const end = Math.max(start + 0.001, angle - gap);
          const full = slices.length === 1;
          return (
            <g
              key={slice.key}
              onMouseEnter={() => onActive(slice.key)}
              onMouseLeave={() => onActive(null)}
              onClick={onSelect ? () => onSelect(slice.key) : undefined}
              style={onSelect ? { cursor: "pointer" } : undefined}
            >
              {full ? (
                <circle cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={radius} fill="none" stroke={slice.color} strokeWidth={DONUT_RING} />
              ) : (
                <path
                  d={arc(start, end, radius)}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={DONUT_RING}
                  opacity={active && active !== slice.key ? 0.35 : 1}
                />
              )}
              {/* A wider invisible ring: an easier target than the segment itself. */}
              {!full && <path d={arc(start, end, radius)} fill="none" stroke="transparent" strokeWidth={DONUT_RING + 12} />}
            </g>
          );
        })}
      </svg>
      <div className="donut-center">
        {focus ? (
          <>
            <div className="num donut-value">{money(focus.value, "EUR", { maximumFractionDigits: 0 })}</div>
            <div className="muted small donut-label">
              {focus.label} · {percent(focus.share)}
            </div>
          </>
        ) : (
          <>
            <div className="num donut-value">{total}</div>
            <div className="muted small">{totalLabel}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** The donut's legend: every segment named, with its share, so color is never the only key. */
export function DonutLegend({
  slices,
  active,
  onActive,
  selected,
  onSelect,
  showValues,
}: {
  slices: DonutSlice[];
  active: string | null;
  onActive: (key: string | null) => void;
  showValues?: boolean; // amounts beside the shares
} & Pickable) {
  const max = Math.max(...slices.map((s) => s.share), 0.0001);
  return (
    <div className="donut-legend" role="table">
      {slices.map((slice) => (
        <div
          key={slice.key}
          role={onSelect ? "button" : "row"}
          {...pickProps(slice.key, { selected, onSelect }, active && active !== slice.key ? "legend-row dimmed" : "legend-row")}
          onMouseEnter={() => onActive(slice.key)}
          onMouseLeave={() => onActive(null)}
        >
          <span role="cell" className="legend-name">
            <span className="swatch" style={{ background: slice.color }} aria-hidden />
            <span className="ellipsis">{slice.label}</span>
          </span>
          <span className="legend-track" aria-hidden>
            <span className="legend-bar" style={{ width: `${(slice.share / max) * 100}%`, background: slice.color }} />
          </span>
          <span role="cell" className="num small secondary">
            {showValues && <span className="legend-amount">{money(slice.value, "EUR", { maximumFractionDigits: 0 })}</span>}
            {percent(slice.share)}
          </span>
        </div>
      ))}
    </div>
  );
}
