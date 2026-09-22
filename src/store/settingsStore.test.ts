import { beforeEach, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settingsStore';

const { storage } = vi.hoisted(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  return { storage };
});
const legacyOpener = 'Summarize the current situation in short, then wait for my next instruction.';
beforeEach(() => useSettingsStore.getState().resetSettings());

it('new and reset settings do not send a fork opening message', () => {
  expect(useSettingsStore.getState().settings.forkOpeningMessage).toBe('');
  useSettingsStore.getState().updateSettings({ forkOpeningMessage: 'Custom request' });
  useSettingsStore.getState().resetSettings();
  expect(useSettingsStore.getState().settings.forkOpeningMessage).toBe('');
});

it('migrates the previous canned summary prompt without changing other saved preferences', async () => {
  storage.setItem('tessera-settings', JSON.stringify({ version: 1, state: { settings: {
    forkOpeningMessage: ` ${legacyOpener} `, fontSize: 18, defaultModel: 'sonnet',
    defaultPermissionMode: 'manual', defaultSkipPermissions: true,
  } } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().settings).toMatchObject({ forkOpeningMessage: '', fontSize: 18,
    defaultModel: 'sonnet', defaultPermissionMode: 'manual', defaultSkipPermissions: true });
  const saved = JSON.parse(storage.getItem('tessera-settings')!);
  expect(saved.version).toBe(2);
  expect(saved.state.settings.forkOpeningMessage).toBe('');
});

it.each(['', 'Continue with the implementation.'])('preserves an explicitly chosen opener: %j', async (opening) => {
  storage.setItem('tessera-settings', JSON.stringify({ version: 1, state: { settings: { forkOpeningMessage: opening } } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().settings.forkOpeningMessage).toBe(opening);
});

it('still applies the older settings migration when upgrading directly from v0', async () => {
  storage.setItem('tessera-settings', JSON.stringify({ version: 0, state: { settings: {
    forkOpeningMessage: legacyOpener, defaultModel: 'sonnet', defaultPermissionMode: 'default', defaultSkipPermissions: true,
  } } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().settings).toMatchObject({ forkOpeningMessage: '', defaultModel: 'opus',
    defaultPermissionMode: 'auto', defaultSkipPermissions: false });
});

it('fills an absent opener with the empty default', async () => {
  storage.setItem('tessera-settings', JSON.stringify({ version: 1, state: { settings: { fontSize: 16 } } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().settings.forkOpeningMessage).toBe('');
});

it('does not discard the same text if explicitly configured again after migration', async () => {
  storage.setItem('tessera-settings', JSON.stringify({ version: 2, state: { settings: { forkOpeningMessage: legacyOpener } } }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().settings.forkOpeningMessage).toBe(legacyOpener);
});
