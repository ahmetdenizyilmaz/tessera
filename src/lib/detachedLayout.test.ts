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
