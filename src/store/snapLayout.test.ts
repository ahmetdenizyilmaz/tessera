import { beforeEach, describe, expect, it } from 'vitest';
import { computeGutters, computeSnapLayout, detectSnapZone, useLayoutStore } from './layoutStore';
import { outsideTabStrip } from './windowDragStore';
import type { SnapZone } from '../types/session';

const zones: SnapZone[] = ['left', 'right', 'top', 'bottom', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const layout = () => useLayoutStore.getState();
beforeEach(() => useLayoutStore.setState(useLayoutStore.getInitialState(), true));

describe('snap geometry and visible panel count', () => {
  for (let count = 1; count <= 12; count++) {
    it.each(zones)(`${count} panels: preview equals the committed %s drop, covers the workspace without overlap`, zone => {
      const ids = Array.from({ length: count }, (_, i) => `panel-${i}`);
      ids.forEach(id => layout().addPanel(id));
      layout().setFocused(ids[0]);
      useLayoutStore.setState({ stealFraction: { x: .36, y: .64 }, sidebarSlotFractions: [10, 20, 30, 40] });
      const moving = ids.at(-1)!;
      const state = layout();
      const preview = computeSnapLayout(ids, moving, zone, state.layoutConfig, state.stealFraction, state.sidebarSlotFractions);
      expect([...preview.panelRects.keys()].sort()).toEqual([...ids].sort());
      const rects = [...preview.panelRects.values()];
      expect(rects.reduce((total, r) => total + r.w * r.h, 0)).toBeCloseTo(10000);
      for (const [i, r] of rects.entries()) {
        expect(r.x).toBeGreaterThanOrEqual(-.00001); expect(r.y).toBeGreaterThanOrEqual(-.00001);
        expect(r.w).toBeGreaterThan(0); expect(r.h).toBeGreaterThan(0);
        expect(r.x + r.w).toBeLessThanOrEqual(100.00001); expect(r.y + r.h).toBeLessThanOrEqual(100.00001);
        for (const other of rects.slice(i + 1)) {
          const overlapX = Math.min(r.x + r.w, other.x + other.w) - Math.max(r.x, other.x);
          const overlapY = Math.min(r.y + r.h, other.y + other.h) - Math.max(r.y, other.y);
          expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(.00001);
        }
      }
      layout().applySnap(moving, zone);
      expect(layout().panelRects).toEqual(preview.panelRects);
      expect(layout().focusedId).toBe(moving);
      const main = layout().panelRects.get(moving)!;
      if (count !== 4) {
        if (zone === 'left') expect(main.x).toBeCloseTo(0);
        if (zone === 'right') expect(main.x + main.w).toBeCloseTo(100);
        if (zone === 'top') expect(main.y).toBeCloseTo(0);
        if (zone === 'bottom') expect(main.y + main.h).toBeCloseTo(100);
      }
    });
  }

  it.each(['left', 'right', 'top', 'bottom'] as const)('retains a resized %s layout when focus changes', zone => {
    ['a', 'b', 'c', 'd', 'e'].forEach(id => layout().addPanel(id));
    layout().applySnap('a', zone);
    const vertical = zone === 'top' || zone === 'bottom';
    const axis = vertical ? 'y' : 'x';
    const gutter = computeGutters(layout().panelRects).find(g => g.axis === axis)!;
    const delta = zone === 'right' || zone === 'bottom' ? 25 : -25;
    const rects = new Map(layout().panelRects);
    for (const id of gutter.panelsBefore) {
      const r = rects.get(id)!;
      rects.set(id, vertical ? { ...r, h: r.h + delta } : { ...r, w: r.w + delta });
    }
    for (const id of gutter.panelsAfter) {
      const r = rects.get(id)!;
      rects.set(id, vertical ? { ...r, y: r.y + delta, h: r.h - delta } : { ...r, x: r.x + delta, w: r.w - delta });
    }
    layout().setRawPanelRects(rects);
    layout().finishResize(axis, gutter.panelsBefore, gutter.panelsAfter);
    layout().setFocused('b');
    expect(layout().layoutConfig?.direction).toBe(zone);
    expect(vertical ? layout().panelRects.get('b')!.h : layout().panelRects.get('b')!.w).toBeCloseTo(55);
  });

  it('does not offer a layout target outside the workspace', () => {
    for (let n = 1; n <= 12; n++) {
      for (const [x, y] of [[-1, 50], [101, 50], [50, -1], [50, 101], [NaN, 50]]) expect(detectSnapZone(x, y, 100, 100, n)).toBeNull();
    }
  });
  it('allows comfortable tab reordering and tears off only after leaving the strip margin', () => {
    const strip = { left: 20, top: 40, right: 900, bottom: 80 };
    expect(outsideTabStrip(500, 100, strip)).toBe(false);
    expect(outsideTabStrip(500, 113, strip)).toBe(true);
    expect(outsideTabStrip(-13, 60, strip)).toBe(true);
    expect(outsideTabStrip(933, 60, strip)).toBe(true);
  });
});
