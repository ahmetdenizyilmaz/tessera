import { beforeEach, expect, it } from 'vitest';
import { computeRects, createLayoutStore, validSlotRects } from './layoutStore';
import { usePanelLockStore } from './panelLockStore';
import type { LayoutConfig, PanelRect } from '../types/session';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const customSlots: PanelRect[] = [
  { x: 0, y: 0, w: 50, h: 90 }, { x: 50, y: 0, w: 50, h: 45 }, { x: 50, y: 45, w: 50, h: 45 },
  { x: 0, y: 90, w: 55, h: 10 }, { x: 55, y: 90, w: 10, h: 10 }, { x: 65, y: 90, w: 10, h: 10 }, { x: 75, y: 90, w: 25, h: 10 },
];
const shape = (rects: Map<string, PanelRect>) => [...rects.values()].map(r => JSON.stringify(r)).sort();
function setup() {
  const store = createLayoutStore();
  ids.forEach(id => store.getState().addPanel(id)); store.getState().setFocused('a');
  const order = store.getState().layoutConfig!.panelOrder;
  store.getState().setRawPanelRects(new Map(order.map((id, i) => [id, customSlots[i]])));
  store.getState().finishResize('x', [order[0]], [order[1], order[2]]);
  return store;
}
beforeEach(() => usePanelLockStore.setState({ lockedIds: new Set() }));

it('retains every manually resized divider, including independent footer segments, through focus and maximize', () => {
  const store = setup(), initial = shape(store.getState().panelRects);
  for (const id of [...ids, ...ids.slice().reverse()]) {
    store.getState().setFocused(id);
    expect(shape(store.getState().panelRects)).toEqual(initial);
    expect(store.getState().panelRects.get(id)).toEqual(customSlots[0]);
    store.getState().toggleMaximized(id); store.getState().toggleMaximized(id);
    expect(shape(store.getState().panelRects)).toEqual(initial);
  }
});
it('recovers all resized slots from an older workspace and discards them only on an explicit layout reset', () => {
  const store = setup(), state = store.getState(), initial = shape(state.panelRects);
  const { slotRects: _, ...oldConfig } = state.layoutConfig!;
  store.getState().restoreLayout(state.tabOrder, state.activeTabId, state.focusedId, oldConfig, state.panelRects, state.stealFraction);
  store.getState().setFocused('e');
  expect(shape(store.getState().panelRects)).toEqual(initial);
  store.getState().resetStealFraction();
  expect(store.getState().layoutConfig?.slotRects).toBeUndefined();
  expect(store.getState().panelRects.get('e')?.w).toBe(80);
});
it('skips locked small slots during clockwise rotation, but lets a selected locked panel become main', () => {
  const store = setup();
  const order = store.getState().layoutConfig!.panelOrder;
  const pinned = [order[2], order[5]];
  pinned.forEach(id => usePanelLockStore.getState().setLocked(id, true));
  const oldRects = new Map(store.getState().panelRects);
  for (const id of ids.filter(id => !pinned.includes(id))) {
    store.getState().setFocused(id);
    pinned.forEach(id => expect(store.getState().panelRects.get(id)).toEqual(oldRects.get(id)));
    expect(shape(store.getState().panelRects)).toEqual(shape(oldRects));
  }
  store.getState().setFocused(pinned[0]);
  expect(store.getState().panelRects.get(pinned[0])).toEqual(customSlots[0]);
  const target = ids.find(id => !pinned.includes(id))!;
  store.getState().setFocused(target);
  expect(store.getState().panelRects.get(target)).toEqual(customSlots[0]);
  expect(store.getState().panelRects.get(pinned[1])).toEqual(oldRects.get(pinned[1]));
  expect(usePanelLockStore.getState().lockedIds.has(pinned[0])).toBe(true);
});
it('swaps only the main and directly selected panels when every panel is locked', () => {
  const store = setup(), before = new Map(store.getState().panelRects), main = store.getState().layoutConfig!.panelOrder[0];
  ids.forEach(id => usePanelLockStore.getState().setLocked(id, true));
  store.getState().setFocused('g');
  expect(store.getState().panelRects.get('g')).toEqual(before.get(main));
  expect(store.getState().panelRects.get(main)).toEqual(before.get('g'));
  for (const id of ids.filter(id => id !== main && id !== 'g')) expect(store.getState().panelRects.get(id)).toEqual(before.get(id));
});
it.each([2, 3, 4])('keeps manually resized slots fixed when focusing a %s-panel layout', count => {
  const store = createLayoutStore(); ids.slice(0, count).forEach(id => store.getState().addPanel(id));
  const config = store.getState().layoutConfig!;
  const rects = computeRects(config, 'a', { x: .2, y: .1 });
  store.getState().setRawPanelRects(rects);
  store.getState().finishResize('x', ['a'], ['b']);
  ids.slice(0, count).forEach(id => { store.getState().setFocused(id); expect(store.getState().panelRects).toEqual(rects); });
});
it.each(['left', 'right', 'top', 'bottom'])('keeps pinned slots stable in the %s layout', direction => {
  const store = createLayoutStore(); ids.forEach(id => store.getState().addPanel(id));
  store.getState().applySnap('a', direction as 'left');
  const original = new Map(store.getState().panelRects);
  usePanelLockStore.getState().setLocked('c', true);
  store.getState().setFocused('f');
  expect(store.getState().panelRects.get('c')).toEqual(original.get('c'));
  expect(shape(store.getState().panelRects)).toEqual(shape(original));
});
it('ignores corrupt saved slots and resets stale slots when the panel count changes', () => {
  for (const slots of [[{ x: 0, y: 0, w: Infinity, h: 100 }], [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 1, h: 1 }]]) {
    expect(validSlotRects(slots, slots.length)).toBe(false);
    const config: LayoutConfig = { type: 'main', panelOrder: ids, slotRects: slots };
    expect(computeRects(config, 'a', { x: .5, y: .5 }).size).toBe(7);
  }
  const store = setup(); store.getState().addPanel('new'); store.getState().removePanel('new');
  expect(store.getState().layoutConfig?.slotRects).toBeUndefined();
  expect(validSlotRects([...store.getState().panelRects.values()], 7)).toBe(true);
});
