import { beforeEach, expect, it } from 'vitest';
import { normalizePanelShortcuts, usePanelShortcutStore } from './panelShortcutStore';

beforeEach(() => usePanelShortcutStore.getState().restore({}));

it('assigns each number and panel at most once, including zero', () => {
  const store = usePanelShortcutStore.getState();
  store.assign('1', 'first');
  store.assign('2', 'second');
  store.assign('1', 'second');
  expect(usePanelShortcutStore.getState().bindings).toEqual({ 1: 'second' });
  store.assign('0', 'second');
  expect(usePanelShortcutStore.getState().bindings).toEqual({ 0: 'second' });
  store.assign('10', 'invalid');
  store.assign('x', 'invalid');
  expect(usePanelShortcutStore.getState().bindings).toEqual({ 0: 'second' });
});

it('removes closed panels without touching other assignments', () => {
  usePanelShortcutStore.getState().restore({ 1: 'first', 2: 'second' });
  usePanelShortcutStore.getState().removePanels(['first', 'unassigned']);
  expect(usePanelShortcutStore.getState().bindings).toEqual({ 2: 'second' });
});

it('restores only valid unique bindings and never restores held modifier keys', () => {
  expect(normalizePanelShortcuts({ 1: 'first', 2: 'first', 3: 123, 4: '', 99: 'invalid', x: 'invalid', 0: 'zero' }))
    .toEqual({ 0: 'zero', 1: 'first' });
  usePanelShortcutStore.getState().setModifiers(true, true);
  usePanelShortcutStore.getState().restore({ 3: 'third' });
  expect(usePanelShortcutStore.getState().ctrlHeld).toBe(false);
  expect(usePanelShortcutStore.getState().altHeld).toBe(false);
  expect(normalizePanelShortcuts(null)).toEqual({});
  expect(normalizePanelShortcuts(['not-a-binding'])).toEqual({});
});

it('holding Ctrl or Alt does not mutate persisted bindings', () => {
  usePanelShortcutStore.getState().assign('1', 'first');
  const bindings = usePanelShortcutStore.getState().bindings;
  usePanelShortcutStore.getState().setModifiers(true, false);
  usePanelShortcutStore.getState().setModifiers(false, true);
  usePanelShortcutStore.getState().setModifiers(false, false);
  expect(usePanelShortcutStore.getState().bindings).toBe(bindings);
});
