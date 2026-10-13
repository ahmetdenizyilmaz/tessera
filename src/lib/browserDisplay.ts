export const DEFAULT_BROWSER_LIVE_SHARE = 1 / 3;
export type BrowserDisplayMode = 'live' | 'focus';
export interface BrowserSizePreference { share: number; mode: BrowserDisplayMode }

export function validBrowserSizePreference(value: unknown): value is BrowserSizePreference {
  if (!value || typeof value !== 'object') return false;
  const preference = value as BrowserSizePreference;
  return Number.isFinite(preference.share) && preference.share > 0 && preference.share < DEFAULT_BROWSER_LIVE_SHARE
    && (preference.mode === 'live' || preference.mode === 'focus');
}

/** A saved size is a share of the containing workspace, just like the default.
 * Round comparisons to 0.01% so subpixel layout differences don't flip the
 * selected behavior when an equivalent panel is reopened or moved. */
export function browserDisplayMode(share: number, preference?: BrowserSizePreference): BrowserDisplayMode {
  if (share >= DEFAULT_BROWSER_LIVE_SHARE) return 'live';
  if (!Number.isFinite(share) || share <= 0 || !validBrowserSizePreference(preference)) return 'focus';
  const current = Math.round(share * 10000), saved = Math.round(preference.share * 10000);
  return current > saved || current === saved && preference.mode === 'live' ? 'live' : 'focus';
}

export function browserPanelShare(element: HTMLElement): number | null {
  const tile = element.closest<HTMLElement>('[data-panel-id]');
  const workspace = element.closest<HTMLElement>('.mosaic-container');
  if (!tile || !workspace) return null;
  const panel = tile.getBoundingClientRect(), area = workspace.getBoundingClientRect();
  if (panel.width <= 0 || panel.height <= 0 || area.width <= 0 || area.height <= 0) return null;
  return panel.width * panel.height / (area.width * area.height);
}
