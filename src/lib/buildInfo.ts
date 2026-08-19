/**
 * Build identity, injected by vite.config.ts. The version string never changes
 * between rebuilds, so the short git hash is the part that tells the running
 * build apart — compare it against `git log --oneline -1`.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const BUILD_HASH: string =
  typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

/** e.g. "v0.1.0 · 538c62f" */
export const BUILD_LABEL = `v${APP_VERSION} · ${BUILD_HASH}`;

/** Local build date for tooltips, e.g. "2026-08-19 16:04" */
export function buildDateLabel(): string {
  if (!BUILD_TIME) return 'dev build';
  const d = new Date(BUILD_TIME);
  if (Number.isNaN(d.getTime())) return BUILD_TIME;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
