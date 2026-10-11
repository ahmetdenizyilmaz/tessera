import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDetachedLayout, connectDetachedLayout } from './detachedLayout';
import { useLayoutStore, computeRects } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';
import { usePluginStore } from '../store/pluginStore';
import { useInstanceStore } from '../store/instanceStore';
import { serializeWorkspace, deserializeWorkspace } from './workspaceSerializer';
import { registerBuiltins } from './builtinPlugins';

const disposers: (() => void)[] = [];
beforeEach(() => {
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useGroupStore.setState(useGroupStore.getInitialState(), true);
  usePluginStore.setState({ instances: new Map() });
  useInstanceStore.setState({ instances: new Map() });
  registerBuiltins();
});
afterEach(() => { disposers.splice(0).forEach(stop => stop()); });
function makeGroup(count: number) {
  const group = useGroupStore.getState().createGroup(null);
  for (let i = 0; i < count; i++) {
    const id = `${group}-panel-${i}`;
    usePluginStore.getState().restoreInstance('timer', id);
    useLayoutStore.getState().addPanel(id, 'plugin');
    useGroupStore.getState().movePanelToLevel(id, group);
  }
  const layout = createDetachedLayout(group);
  disposers.push(connectDetachedLayout(layout, group));
  return { group, layout };
}
it.each([1, 2, 3, 4, 5, 8, 12])('uses Main layout geometry for %i detached panels', count => {
  const { layout } = makeGroup(count);
  const s = layout.getState();
  expect(s.panelRects.size).toBe(count);
  expect(s.panelRects).toEqual(computeRects(s.layoutConfig!, s.focusedId, s.stealFraction, s.sidebarSlotFractions));
  expect([...s.panelRects.values()].reduce((a, r) => a + r.w * r.h, 0)).toBeCloseTo(10000);
});
it('keeps focus, maximize, snapping and divider preferences independent in each window', () => {
  useLayoutStore.getState().addPanel('main');
  const first = makeGroup(5), second = makeGroup(3);
  const mainBefore = useLayoutStore.getState(), secondBefore = second.layout.getState();
  const id = first.layout.getState().tabOrder[2];
  first.layout.getState().applySnap(id, 'right');
  first.layout.setState({ sidebarSlotFractions: [10, 20, 30, 40] });
  first.layout.getState().toggleMaximized(id);
  first.layout.getState().cycleFocus(1);
  expect(first.layout.getState().maximizedId).toBe(first.layout.getState().focusedId);
  expect(useLayoutStore.getState()).toBe(mainBefore);
  expect(second.layout.getState()).toBe(secondBefore);
  const saved = useGroupStore.getState().groups.get(first.group)!;
  expect(saved.layoutConfig?.direction).toBe('right');
  expect(saved.sidebarSlotFractions).toEqual([10, 20, 30, 40]);
  const reopened = createDetachedLayout(first.group).getState();
  expect(reopened.panelRects).toEqual(first.layout.getState().panelRects);
  expect(reopened.maximizedId).toBeNull();
});
it('responds to incoming panels and external focus without changing Main, and persists the result', () => {
  const { group, layout } = makeGroup(2);
  usePluginStore.getState().restoreInstance('lichess', 'incoming');
  useLayoutStore.getState().addPanel('incoming', 'plugin');
  useGroupStore.getState().movePanelToLevel('incoming', group);
  useGroupStore.getState().setGroupActiveChild(group, 'incoming');
  expect(layout.getState().focusedId).toBe('incoming');
  expect(layout.getState().panelRects.size).toBe(3);
  expect(useGroupStore.getState().groups.get(group)?.focusedChildId).toBe('incoming');
  layout.setState({ sidebarSlotFractions: [15, 25, 25, 35] });
  layout.getState().applySnap('incoming', 'bottom');
  const snapshot = serializeWorkspace();
  disposers.splice(0).forEach(stop => stop());
  deserializeWorkspace(JSON.parse(JSON.stringify(snapshot)));
  const reopened = createDetachedLayout(group).getState();
  expect(reopened.layoutConfig?.direction).toBe('bottom');
  expect(reopened.sidebarSlotFractions).toEqual([15, 25, 25, 35]);
  expect(reopened.panelRects.size).toBe(3);
});

it.each(['top', 'right'] as const)('keeps clockwise movement after reopening a legacy %s detached layout', direction => {
  const { group, layout } = makeGroup(8);
  const ids = layout.getState().tabOrder;
  const config = { type: 'main' as const, direction, panelOrder: ids, mainWidthPercent: 65 };
  const fractions = [10, 20, 30, 40];
  const legacy = new Map([...computeRects({ ...config, direction: 'left' }, ids[0], { x: .5, y: .5 }, fractions)]
    .map(([id, r]) => [id, direction === 'top'
      ? { x: r.y, y: r.x, w: r.h, h: r.w } : { ...r, x: 100 - r.x - r.w }]));
  useGroupStore.setState(s => ({ groups: new Map(s.groups).set(group, {
    ...s.groups.get(group)!, layoutConfig: config, panelRects: legacy, sidebarSlotFractions: fractions,
    activeChildId: ids[0], focusedChildId: ids[0],
  }) }));
  const reopened = createDetachedLayout(group);
  expect(reopened.getState().panelRects).toEqual(legacy);
  const expectedOrder = [ids[0], ...ids.slice(1).reverse()];
  expect(reopened.getState().layoutConfig!.panelOrder).toEqual(expectedOrder);
  // Selecting from the parent follows the same movement as a local click.
  useGroupStore.getState().setGroupActiveChild(group, ids.at(-1)!);
  expect(layout.getState().panelRects.get(ids[0])).toEqual(legacy.get(ids.at(-1)!));
  expect(layout.getState().panelRects.get(ids.at(-1)!)).toEqual(legacy.get(ids[0]));
  for (const id of ids.slice(1, -1)) expect(layout.getState().panelRects.get(id)).toEqual(legacy.get(id));
});
