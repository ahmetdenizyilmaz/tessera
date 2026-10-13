import { expect, it } from 'vitest';
import { computeGutters, computeRects, validSlotRects, createLayoutStore, computeSnapLayout } from '../store/layoutStore';
import { usePanelLockStore } from '../store/panelLockStore';
import type { LayoutConfig, PanelRect } from '../types/session';
import { resizePanels } from './panelResize';

const rectMap = (...rects: PanelRect[]) => new Map(rects.map((r, i) => [String(i), r]));

it.each(['left', 'right', 'top', 'bottom'] as const)('resizes the complete main/footer group in a twelve-panel %s layout', direction => {
  const config: LayoutConfig = { type: 'main', direction, panelOrder: Array.from({ length: 12 }, (_, i) => String(i)) };
  const rects = computeRects(config, '0', { x: .5, y: .5 });
  const axis = direction === 'top' || direction === 'bottom' ? 'y' : 'x';
  const gutter = computeGutters(rects).find(g => g.axis === axis && g.panelsBefore.concat(g.panelsAfter).includes('0'))!;
  const delta = direction === 'left' || direction === 'top' ? -30 : 30;
  const changed = resizePanels(rects, gutter, delta);
  expect(changed.get('0')![axis === 'x' ? 'w' : 'h']).toBeCloseTo(50);
  expect(validSlotRects([...changed.values()], 12)).toBe(true);
  const again = computeGutters(changed).find(g => g.axis === axis && g.panelsBefore.concat(g.panelsAfter).includes('0'))!;
  const restored = resizePanels(changed, again, -delta);
  for (const [id, r] of rects) for (const key of ['x', 'y', 'w', 'h'] as const) expect(restored.get(id)![key]).toBeCloseTo(r[key]);
});

it('does not join nearby dividers or aligned segments separated by another panel', () => {
  const close = rectMap({ x: 0, y: 0, w: 50, h: 50 }, { x: 50, y: 0, w: 50, h: 50 },
    { x: 0, y: 50, w: 50.5, h: 50 }, { x: 50.5, y: 50, w: 49.5, h: 50 });
  expect(computeGutters(close).filter(g => g.axis === 'x')).toHaveLength(2);
  const separated = rectMap({ x: 0, y: 0, w: 50, h: 25 }, { x: 50, y: 0, w: 50, h: 25 },
    { x: 0, y: 25, w: 100, h: 50 }, { x: 0, y: 75, w: 50, h: 25 }, { x: 50, y: 75, w: 50, h: 25 });
  const gutters = computeGutters(separated).filter(g => g.axis === 'x');
  expect(gutters).toHaveLength(2);
  const changed = resizePanels(separated, gutters[0], 15);
  expect(changed.get('3')).toEqual(separated.get('3'));
  expect(changed.get('4')).toEqual(separated.get('4'));
  expect(validSlotRects([...changed.values()], 5)).toBe(true);
});

it('keeps narrow footer dividers movable and clamps without gaps, overlap, or a jump on grab', () => {
  const rects = rectMap({ x: 0, y: 0, w: 100, h: 80 }, { x: 0, y: 80, w: 90, h: 20 },
    { x: 90, y: 80, w: 5, h: 20 }, { x: 95, y: 80, w: 5, h: 20 });
  const gutter = computeGutters(rects).find(g => g.axis === 'x' && g.position === 95)!;
  expect(resizePanels(rects, gutter, 0)).toEqual(rects);
  for (const delta of [-100, -1, 1, 100]) {
    const next = resizePanels(rects, gutter, delta);
    expect(next.get('2')!.w).not.toBe(5);
    expect(next.get('0')).toEqual(rects.get('0'));
    expect(validSlotRects([...next.values()], 4)).toBe(true);
  }
});

it('preserves nonuniform footer proportions when its shared outer divider moves', () => {
  const rects = rectMap({ x: 0, y: 0, w: 60, h: 80 }, { x: 60, y: 0, w: 40, h: 100 },
    { x: 0, y: 80, w: 10, h: 20 }, { x: 10, y: 80, w: 20, h: 20 }, { x: 30, y: 80, w: 30, h: 20 });
  const gutter = computeGutters(rects).find(g => g.axis === 'x' && g.position === 60)!;
  const changed = resizePanels(rects, gutter, -30);
  expect(['2', '3', '4'].map(id => changed.get(id)!.w)).toEqual([5, 10, 15]);
  expect(validSlotRects([...changed.values()], 5)).toBe(true);
});

it('keeps locked small panels at the same geometry in both drag preview and committed drops', () => {
  usePanelLockStore.setState({ lockedIds: new Set() });
  try {
    const layout = createLayoutStore();
    for (let i = 0; i < 7; i++) layout.getState().addPanel(String(i));
    layout.getState().setFocused('0');
    const pinned = layout.getState().layoutConfig!.panelOrder[2];
    usePanelLockStore.getState().setLocked(pinned, true);
    const fixed = layout.getState().panelRects.get(pinned);
    for (const zone of ['left', 'right', 'top', 'bottom', 'center', 'top-right', 'bottom-left'] as const) {
      const state = layout.getState();
      const preview = computeSnapLayout(state.tabOrder, '4', zone, state.layoutConfig, state.stealFraction,
        state.sidebarSlotFractions, state.panelRects, usePanelLockStore.getState().lockedIds);
      layout.getState().applySnap('4', zone);
      expect(layout.getState().panelRects).toEqual(preview.panelRects);
      expect(layout.getState().panelRects.get(pinned)).toEqual(fixed);
      expect(validSlotRects([...preview.panelRects.values()], 7)).toBe(true);
    }
  } finally { usePanelLockStore.setState({ lockedIds: new Set() }); }
});
