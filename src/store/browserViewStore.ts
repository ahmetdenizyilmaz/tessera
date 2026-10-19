import { create } from 'zustand';
import { validBrowserSizePreference, type BrowserSizePreference } from '../lib/browserDisplay';

export const BROWSER_VIEWS_KEY = 'tessera-browser-views';
type Preferences = Record<string, BrowserSizePreference>;
// Website players use simple slugs; HTML apps use their validated manifest ID,
// such as html-tessera.game-radius-raid. Keep that identity intact on save/load.
const validSite = (site: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,120}$/.test(site)
  || /^html-[a-z0-9][a-z0-9.-]{0,79}$/.test(site) && site.slice(5).split('.').every(Boolean);

function load(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(BROWSER_VIEWS_KEY) ?? 'null');
    if (saved?.version !== 1 || !saved.preferences || typeof saved.preferences !== 'object' || Array.isArray(saved.preferences)) return {};
    return Object.fromEntries(Object.entries(saved.preferences).filter(([site, value]) => validSite(site) && validBrowserSizePreference(value))) as Preferences;
  } catch { return {}; }
}

export const useBrowserViewStore = create<{
  preferences: Preferences;
  setPreference: (site: string, preference: BrowserSizePreference | null) => void;
}>((set, get) => ({
  preferences: load(),
  setPreference: (site, preference) => {
    if (!validSite(site) || preference !== null && !validBrowserSizePreference(preference)) throw new Error('Choose a panel size below one-third of the workspace.');
    const preferences = { ...get().preferences };
    if (preference) preferences[site] = { share: preference.share, mode: preference.mode };
    else delete preferences[site];
    // A failed save leaves the old setting intact and is reported by the menu.
    localStorage.setItem(BROWSER_VIEWS_KEY, JSON.stringify({ version: 1, preferences }));
    set({ preferences });
  },
}));
