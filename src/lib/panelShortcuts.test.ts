import { beforeEach, expect, it } from 'vitest';
import { focusShortcutPanel, panelGroupPath, shortcutNumber } from './panelShortcuts';
import { captureGroupSnapshot, removePanelsFromWorkspace, useGroupStore } from '../store/groupStore';
import { useLayoutStore } from '../store/layoutStore';
import { usePanelShortcutStore } from '../store/panelShortcutStore';

beforeEach(() => {
  useLayoutStore.setState({ tabOrder: [], panelTypes: {}, widgetKinds: {}, layoutConfig: null,
    panelRects: new Map(), focusedId: null, activeTabId: null, maximizedId: null });
  useGroupStore.getState().restoreGroups(new Map());
  useGroupStore.setState({ groups: new Map() });
  usePanelShortcutStore.getState().restore({});
});
const add = (id: string) => useLayoutStore.getState().addPanel(id, 'terminal');
const enter = (id: string) => {
  useGroupStore.getState().enterGroup(id);
  useGroupStore.getState().commitEnterGroup();
};

it('focuses the assigned panel without relying on its tab position, including while maximized', () => {
  add('first'); add('second');
  useLayoutStore.getState().moveTab(0, 1);
  useLayoutStore.getState().toggleMaximized('second');
  expect(focusShortcutPanel('first')).toBe(true);
  expect(useLayoutStore.getState()).toMatchObject({ focusedId: 'first', activeTabId: 'first', maximizedId: 'first' });
});

it('finds live unsaved children and jumps between nested groups without losing root panels', () => {
  add('root');
  const outer = useGroupStore.getState().createGroup(null);
  useLayoutStore.getState().addPanel(outer, 'group');
  enter(outer);
  add('outer-child');
  const nested = useGroupStore.getState().createGroup(outer);
  useLayoutStore.getState().addPanel(nested, 'group');
  enter(nested);
  add('nested-child');
  expect(panelGroupPath('root')).toEqual([]);
  expect(panelGroupPath('outer-child')).toEqual([outer]);
  expect(panelGroupPath('nested-child')).toEqual([outer, nested]);
  expect(focusShortcutPanel('root')).toBe(true);
  expect(useGroupStore.getState().groupStack).toEqual([]);
  expect(focusShortcutPanel('nested-child')).toBe(true);
  expect(useGroupStore.getState().groupStack).toEqual([outer, nested]);
  expect(useLayoutStore.getState().focusedId).toBe('nested-child');
  expect(focusShortcutPanel('outer-child')).toBe(true);
  expect(useGroupStore.getState().groupStack).toEqual([outer]);
  expect(captureGroupSnapshot().rootLayout?.tabOrder).toEqual(['root', outer]);
  expect(useGroupStore.getState().transitionDirection).toBeNull();
});

it('refuses closed targets and removes bindings when workspace panels close', () => {
  add('open');
  usePanelShortcutStore.getState().assign('1', 'open');
  expect(focusShortcutPanel('missing')).toBe(false);
  expect(useLayoutStore.getState().focusedId).toBe('open');
  removePanelsFromWorkspace(['open']);
  expect(usePanelShortcutStore.getState().bindings).toEqual({});
  expect(panelGroupPath('open')).toBeNull();
});

it('recognizes number-row and numpad keys without treating other keys as numbers', () => {
  expect(shortcutNumber({ key: '3', code: 'Digit3' })).toBe('3');
  expect(shortcutNumber({ key: '&', code: 'Digit1' })).toBe('1');
  expect(shortcutNumber({ key: 'End', code: 'Numpad1' })).toBe('1');
  expect(shortcutNumber({ key: '0', code: 'Numpad0' })).toBe('0');
  expect(shortcutNumber({ key: 'a', code: 'KeyA' })).toBeNull();
});
