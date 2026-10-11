import { beforeEach, describe, expect, it } from 'vitest';
import { computeGutters, computeRects, computeSnapLayout, detectSnapZone, useLayoutStore } from './layoutStore';
import { outsideTabStrip } from './windowDragStore';
import type { SnapZone } from '../types/session';
import type { LayoutConfig, PanelRect } from '../types/session';

const zones: SnapZone[] = ['left', 'right', 'top', 'bottom', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const layout = () => useLayoutStore.getState();
beforeEach(() => useLayoutStore.setState(useLayoutStore.getInitialState(), true));

// Screen coordinates have y increasing downward: positive area is clockwise.
function winding(order: string[], rects: Map<string, PanelRect>) {
  const points = order.map(id => {
    const r = rects.get(id)!;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  });
  return points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0);
}

describe('clockwise focus movement', () => {
  for (const count of [5, 6, 8, 12]) {
    it.each(['left', 'right', 'top', 'bottom'] as const)(`${count} panels flow clockwise in the %s orientation`, direction => {
      const ids = Array.from({ length: count }, (_, i) => `panel-${i}`);
      ids.forEach(id => layout().addPanel(id));
      useLayoutStore.setState({ sidebarSlotFractions: [10, 20, 30, 40] });
      layout().applySnap(ids[0], direction);
      expect(winding(layout().layoutConfig!.panelOrder, layout().panelRects)).toBeGreaterThan(0);
      for (const clicked of ids.slice(1).reverse()) {
        const before = layout();
        const order = before.layoutConfig!.panelOrder;
        const slots = order.map(id => before.panelRects.get(id)!);
        const index = order.indexOf(clicked);
        layout().setFocused(clicked);
        expect(layout().panelRects.get(clicked)).toEqual(slots[0]);
        // The previous main enters the first clockwise slot; following panels
        // advance until the clicked slot is filled. Later panels stay put.
        for (let i = 0; i < order.length; i++) {
          if (i === index) continue;
          expect(layout().panelRects.get(order[i])).toEqual(slots[i < index ? i + 1 : i]);
        }
        expect(layout().tabOrder).toEqual(ids);
      }
    });
  }

  it('keeps the old main at the top of the right stack', () => {
    const ids = ['main', 'top', 'middle', 'lower', 'last', 'overflow'];
    ids.forEach(id => layout().addPanel(id));
    layout().applySnap('main', 'left');
    layout().setFocused('overflow');
    expect(layout().panelRects.get('main')).toEqual({ x: 80, y: 0, w: 20, h: 25 });
  });

  it.each(['top', 'right'] as const)('restores an older mirrored %s layout without jumping or reversing on the first focus', direction => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const config: LayoutConfig = { type: 'main', panelOrder: ids, direction, mainWidthPercent: 65 };
    const fraction = { x: .5, y: .5 }, slots = [10, 20, 30, 40];
    const legacyRects = new Map([...computeRects({ ...config, direction: 'left' }, 'a', fraction, slots)]
      .map(([id, r]) => [id, direction === 'top'
        ? { x: r.y, y: r.x, w: r.h, h: r.w }
        : { ...r, x: 100 - r.x - r.w }]));
    layout().restoreLayout(ids, 'a', 'a', config, legacyRects, fraction, {}, {}, slots);
    expect(layout().panelRects).toEqual(legacyRects);
    expect(winding(layout().layoutConfig!.panelOrder, layout().panelRects)).toBeGreaterThan(0);
    layout().setFocused('a');
    expect(layout().panelRects).toEqual(legacyRects);
    // This was the first clockwise slot in the saved physical arrangement.
    layout().setFocused('h');
    expect(layout().panelRects.get('a')).toEqual(legacyRects.get('h'));
    expect(layout().panelRects.get('h')).toEqual(legacyRects.get('a'));
    for (const id of ids.slice(1, -1)) expect(layout().panelRects.get(id)).toEqual(legacyRects.get(id));
  });

  it.each(['top', 'right'] as const)('retains resized physical sidebar slots in the %s orientation', direction => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    ids.forEach(id => layout().addPanel(id));
    layout().applySnap('a', direction);
    const vertical = direction === 'top';
    const rectangles = [...layout().panelRects.entries()];
    const side = rectangles.filter(([id, r]) => id !== 'a' && (vertical ? r.y === 80 : r.x === 0))
      .sort(([, a], [, b]) => vertical ? a.x - b.x : a.y - b.y);
    const rects = new Map(layout().panelRects);
    let offset = 0;
    side.forEach(([id, r], i) => {
      const size = [10, 20, 30, 40][i];
      rects.set(id, vertical ? { ...r, x: offset, w: size } : { ...r, y: offset, h: size });
      offset += size;
    });
    layout().setRawPanelRects(rects);
    layout().finishResize(vertical ? 'x' : 'y', [side[0][0]], [side[1][0]]);
    layout().setFocused('a');
    expect(layout().panelRects).toEqual(rects);
    expect(layout().sidebarSlotFractions).toEqual([10, 20, 30, 40]);
  });
});

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
