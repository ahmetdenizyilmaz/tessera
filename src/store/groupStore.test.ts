import { beforeEach, expect, it } from 'vitest';
import { canMovePanelToLevel, captureGroupSnapshot, ensurePanelAtLevel, getPanelLocations, useGroupStore } from './groupStore';
import { useLayoutStore, type PanelType } from './layoutStore';
import { usePanelShortcutStore } from './panelShortcutStore';
import { getExistingPanelOptions, getGroupMoveOptions } from '../lib/groupPanelOptions';

const groups = () => useGroupStore.getState();
const layout = () => useLayoutStore.getState();
const move = (id: string, target: string | null) => groups().movePanelToLevel(id, target);
const enter = (id: string) => { groups().enterGroup(id); groups().commitEnterGroup(); };
const add = (id: string, parent: string | null = null, type: PanelType = 'terminal') => ensurePanelAtLevel(id, parent, type);
const group = (name: string, parent: string | null = null) => {
  const id = groups().createGroup(parent, name);
  add(id, parent, 'group');
  return id;
};

beforeEach(() => {
  groups().restoreGroups(new Map());
  useGroupStore.setState({ groups: new Map() });
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  usePanelShortcutStore.getState().restore({});
});

it('moves a widget into a group and back with its type and shortcut intact', () => {
  const target = group('Work');
  const id = layout().addWidgetPanel('analytics');
  usePanelShortcutStore.getState().assign('1', id);
  move(id, target);
  expect(layout().tabOrder).toEqual([target]);
  expect(groups().groups.get(target)?.childIds).toEqual([id]);
  enter(target);
  expect(layout().tabOrder).toEqual([id]);
  expect(layout().panelTypes[id]).toBe('widget');
  expect(layout().widgetKinds[id]).toBe('analytics');
  move(id, null);
  expect(layout().tabOrder).toEqual([]);
  groups().exitGroup();
  expect(layout().tabOrder).toEqual([target, id]);
  expect(groups().groups.get(target)?.childIds).toEqual([]);
  expect(usePanelShortcutStore.getState().bindings).toEqual({ 1: id });
  expect(layout().panelRects.has(id)).toBe(true);
});

it('pulls multiple root panels into an empty open group and removes saved root membership', () => {
  add('chat'); add('terminal');
  const target = group('Work');
  enter(target);
  move('chat', target); move('terminal', target);
  expect(layout().tabOrder).toEqual(['chat', 'terminal']);
  expect(captureGroupSnapshot().rootLayout?.tabOrder).toEqual([target]);
  expect(captureGroupSnapshot().rootLayout?.focusedId).toBe(target);
  groups().exitGroup();
  expect(layout().tabOrder).toEqual([target]);
  enter(target);
  expect(layout().tabOrder).toEqual(['chat', 'terminal']);
  expect([...layout().panelRects.keys()].sort()).toEqual(['chat', 'terminal']);
});

it('moves between closed sibling groups without changing the visible workspace', () => {
  const source = group('Source'), target = group('Target');
  add('plugin', source, 'plugin');
  const before = layout().tabOrder;
  move('plugin', target);
  expect(layout().tabOrder).toEqual(before);
  expect(groups().groups.get(source)?.childIds).toEqual([]);
  enter(target);
  expect(layout().tabOrder).toEqual(['plugin']);
  expect(layout().panelTypes.plugin).toBe('plugin');
});

it('keeps ancestor snapshots correct when pulling into and moving out of nested groups', () => {
  const outer = group('Outer');
  add('outer-panel', outer, 'llm');
  const inner = group('Inner', outer);
  enter(outer); enter(inner);
  move('outer-panel', inner);
  expect(captureGroupSnapshot().groups.get(outer)?.childIds).toEqual([inner]);
  expect(layout().tabOrder).toEqual(['outer-panel']);
  move('outer-panel', outer);
  expect(layout().tabOrder).toEqual([]);
  groups().exitGroup();
  expect(layout().tabOrder).toEqual([inner, 'outer-panel']);
  expect(layout().panelTypes['outer-panel']).toBe('llm');
  expect([...layout().panelRects.keys()].sort()).toEqual([inner, 'outer-panel'].sort());
});

it('lists Main and sibling destinations while inside a group, and excludes existing members', () => {
  const first = group('First'), second = group('Second');
  add('root-panel'); add('first-panel', first); add('second-panel', second);
  enter(first);
  add('new-panel', first);
  expect(getGroupMoveOptions('first-panel').map(option => option.id)).toEqual([null, second]);
  expect(getExistingPanelOptions(first).map(option => option.id)).toEqual(expect.arrayContaining(['root-panel', 'second-panel']));
  expect(getExistingPanelOptions(first).map(option => option.id)).not.toEqual(expect.arrayContaining(['first-panel']));
  expect(getPanelLocations().get('new-panel')).toBe(first);
});

it('rejects missing destinations, remote panels, group cycles, and moves of open ancestors', () => {
  const parent = group('Parent'), child = group('Child', parent), remote = group('Remote');
  groups().groups.get(remote)!.remotePeerId = 'computer';
  add('local'); add('remote-panel', remote, 'remote');
  for (const [id, target] of [['local', 'missing'], ['local', remote], ['remote-panel', parent], [parent, parent], [parent, child], [remote, parent]]) {
    expect(canMovePanelToLevel(id, target)).toBe(false);
    move(id, target);
  }
  expect(getPanelLocations().get('local')).toBeNull();
  expect(getExistingPanelOptions(parent).map(option => option.id)).not.toContain('remote-panel');
  enter(parent); enter(child);
  expect(canMovePanelToLevel(parent, null)).toBe(false);
});

it('updates nested group parent metadata and treats repeated moves as a no-op', () => {
  const source = group('Source'), target = group('Target'), nested = group('Nested', source);
  add('nested-panel', nested);
  move(nested, target); move(nested, target);
  expect(groups().groups.get(nested)?.parentId).toBe(target);
  expect(groups().groups.get(source)?.childIds).toEqual([]);
  expect(groups().groups.get(target)?.childIds).toEqual([nested]);
  expect(getGroupMoveOptions('nested-panel').find(option => option.id === source)?.name).toBe('Source');
  enter(target); enter(nested);
  expect(layout().tabOrder).toEqual(['nested-panel']);
});
