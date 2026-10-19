import { beforeEach, expect, it, vi } from 'vitest';
import { browserDisplayMode, DEFAULT_BROWSER_LIVE_SHARE, validBrowserSizePreference } from './browserDisplay';

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const storage = { getItem: vi.fn((key: string) => data.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { data.set(key, value); }), clear: () => data.clear() };
  vi.stubGlobal('localStorage', storage);
  return storage;
});
beforeEach(() => { storage.clear(); storage.setItem.mockClear(); });

it('preserves the default and always shows larger panels, regardless of saved choices', () => {
  expect(browserDisplayMode(.25)).toBe('focus');
  for (const share of [DEFAULT_BROWSER_LIVE_SHARE, .5, 1]) {
    expect(browserDisplayMode(share)).toBe('live');
    expect(browserDisplayMode(share, { share: .3, mode: 'focus' })).toBe('live');
  }
});
it('uses the selected current size as the cutoff and tolerates subpixel measurements', () => {
  for (const mode of ['focus', 'live'] as const) {
    const saved = { share: .24986, mode };
    expect(browserDisplayMode(.2, saved)).toBe('focus');
    expect(browserDisplayMode(.3, saved)).toBe('live');
    expect(browserDisplayMode(.249861, saved)).toBe(mode);
  }
});
it('rejects malformed settings and thresholds beyond the always-live boundary', () => {
  for (const value of [null, {}, { share: 0, mode: 'live' }, { share: NaN, mode: 'live' }, { share: .5, mode: 'focus' }, { share: .2, mode: 'hidden' }]) {
    expect(validBrowserSizePreference(value)).toBe(false);
  }
});
it('persists choices by app identity across reloads and resets only the selected app', async () => {
  vi.resetModules();
  const { useBrowserViewStore, BROWSER_VIEWS_KEY } = await import('../store/browserViewStore');
  useBrowserViewStore.getState().setPreference('lichess', { share: .24, mode: 'live' });
  useBrowserViewStore.getState().setPreference('web-app-player', { share: .15, mode: 'focus' });
  vi.resetModules();
  const restored = (await import('../store/browserViewStore')).useBrowserViewStore;
  expect(restored.getState().preferences).toEqual({ lichess: { share: .24, mode: 'live' }, 'web-app-player': { share: .15, mode: 'focus' } });
  restored.getState().setPreference('lichess', null);
  expect(JSON.parse(localStorage.getItem(BROWSER_VIEWS_KEY)!).preferences).toEqual({ 'web-app-player': { share: .15, mode: 'focus' } });
});
it('loads only valid saved app settings and preserves the current setting when saving fails', async () => {
  storage.setItem('tessera-browser-views', JSON.stringify({ version: 1, preferences: { lichess: { share: .2, mode: 'live' }, broken: { share: 9, mode: 'focus' } } }));
  vi.resetModules();
  const { useBrowserViewStore } = await import('../store/browserViewStore');
  expect(Object.keys(useBrowserViewStore.getState().preferences)).toEqual(['lichess']);
  storage.setItem.mockImplementationOnce(() => { throw new Error('Storage full'); });
  expect(() => useBrowserViewStore.getState().setPreference('lichess', null)).toThrow('Storage full');
  expect(useBrowserViewStore.getState().preferences.lichess).toEqual({ share: .2, mode: 'live' });
});

it('saves and restores Live view for dotted HTML game IDs without changing other apps', async () => {
  vi.resetModules();
  const { useBrowserViewStore } = await import('../store/browserViewStore');
  const games = ['html-tessera.game-radius-raid', 'html-tessera.game-menja', 'html-tessera.game-onoff'];
  useBrowserViewStore.getState().setPreference('lichess', { share: .2, mode: 'focus' });
  for (const game of games) useBrowserViewStore.getState().setPreference(game, { share: .295, mode: 'live' });
  vi.resetModules();
  const restored = (await import('../store/browserViewStore')).useBrowserViewStore;
  for (const game of games) {
    expect(browserDisplayMode(.295, restored.getState().preferences[game])).toBe('live');
    expect(browserDisplayMode(.1, restored.getState().preferences[game])).toBe('focus');
  }
  restored.getState().setPreference(games[0], null);
  expect(restored.getState().preferences[games[0]]).toBeUndefined();
  expect(restored.getState().preferences[games[1]]).toEqual({ share: .295, mode: 'live' });
  expect(restored.getState().preferences.lichess).toEqual({ share: .2, mode: 'focus' });
});

it('still rejects malformed app identities when accepting namespaced HTML apps', async () => {
  vi.resetModules();
  const { useBrowserViewStore } = await import('../store/browserViewStore');
  for (const site of ['', '__proto__', 'html-../app', 'html-app..name', 'html-app.', 'html-App.name', 'html-app/name', `html-${'a'.repeat(81)}.game`]) {
    expect(() => useBrowserViewStore.getState().setPreference(site, { share: .2, mode: 'live' })).toThrow();
  }
  expect(useBrowserViewStore.getState().preferences).toEqual({});
});
