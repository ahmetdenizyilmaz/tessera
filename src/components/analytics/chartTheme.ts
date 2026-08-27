/** Shared chart theme for the usage dashboard.
 *
 * The two-series categorical pair is validated (CVD ΔE ≥ 24, contrast ≥ 3:1,
 * dark-band lightness) against the elevated surface — don't swap hues casually;
 * re-run the palette validator if these change. Fixed assignment: Input is
 * always blue, Output always orange, in every chart on the page. */
export const SERIES = {
  input: '#3d87e0',
  output: '#c9701a',
} as const;

/** Single-hue magnitude color for ranked bars and lone-series charts. */
export const MAGNITUDE = SERIES.input;

/** Recessive hairline grid — one step off the surface, solid, never dashed. */
export const GRID = 'rgba(255, 255, 255, 0.06)';

export const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 11 } as const;

export const TOOLTIP_STYLE = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--text-primary)',
} as const;

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatAxisTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

export function formatCost(v: number): string {
  return v >= 100 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}

export function formatShortDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : `${d.getMonth() + 1}/${d.getDate()}`;
}
