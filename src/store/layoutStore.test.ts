import { beforeEach, describe, expect, it } from 'vitest';
import { buildSnapConfig, computeGutters, computeRects, getDefaultConfig, useLayoutStore } from './layoutStore';

const layout = () => useLayoutStore.getState();
const ids = ['a', 'b', 'c', 'd', 'e'];

beforeEach(() => {
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  ids.forEach(id => layout().addPanel(id));
  layout().setFocused('a');
});

// Use the same rectangle delta and gutter membership as MosaicLayout's drag.
function dragMainDivider(width: number) {
  const state = layout();
  const main = state.panelRects.get(state.layoutConfig!.panelOrder[0])!;
  const gutter = computeGutters(state.panelRects).find(g => g.axis === 'x' && g.position === main.w)!;
  const delta = width - main.w;
  const rects = new Map(state.panelRects);
  for (const id of gutter.panelsBefore) {
    const r = rects.get(id)!;
    rects.set(id, { ...r, w: r.w + delta });
  }
  for (const id of gutter.panelsAfter) {
    const r = rects.get(id)!;
    rects.set(id, { ...r, x: r.x + delta, w: r.w - delta });
  }
  state.setRawPanelRects(rects);
  layout().finishResize('x', gutter.panelsBefore, gutter.panelsAfter);
}

describe('stacked layout divider', () => {
  it.each([35, 50, 65])('keeps a %s%% main width when focus changes', width => {
    dragMainDivider(width);
    for (const id of ids) {
      layout().setFocused(id);
      expect(layout().panelRects.get(id)).toMatchObject({ x: 0, w: width });
      for (const sideId of layout().layoutConfig!.panelOrder.slice(1, 5)) {
        expect(layout().panelRects.get(sideId)).toMatchObject({ x: width, w: 100 - width });
      }
    }
    expect(layout().stealFraction).toEqual({ x: 0.5, y: 0.5 });
  });

  it('keeps the split on focus cycling, maximize, snap, and panel-count changes', () => {
    dragMainDivider(55);
    layout().cycleFocus(1);
    layout().toggleMaximized('c');
    layout().toggleMaximized('c');
    layout().applySnap('d', 'left');
    expect(layout().panelRects.get('d')?.w).toBe(55);
    layout().addPanel('f');
    expect(layout().panelRects.get('f')?.w).toBe(55);
    layout().removePanel('f');
    expect(layout().panelRects.get(layout().focusedId!)?.w).toBe(55);
  });

  it('keeps sidebar heights independent of the main width', () => {
    dragMainDivider(50);
    useLayoutStore.setState({ sidebarSlotFractions: [10, 20, 30, 40] });
    layout().setFocused('b');
    expect(layout().panelRects.get('b')?.w).toBe(50);
    expect(layout().layoutConfig!.panelOrder.slice(1).map(id => layout().panelRects.get(id)?.h))
      .toEqual([10, 20, 30, 40]);
  });

  it('resets both the main divider and sidebar slots on double-click', () => {
    dragMainDivider(50);
    useLayoutStore.setState({ sidebarSlotFractions: [10, 20, 30, 40] });
    layout().resetStealFraction();
    layout().setFocused('b');
    expect(layout().panelRects.get('b')?.w).toBe(80);
    expect(layout().sidebarSlotFractions).toEqual([]);
  });

  it('uses the saved width in snap previews and legacy grid layouts', () => {
    dragMainDivider(60);
    const config = buildSnapConfig(ids, 'b', 'left', layout().layoutConfig);
    expect(computeRects(config, 'b', layout().stealFraction).get('b')?.w).toBe(60);
    useLayoutStore.setState({ layoutConfig: { ...config, type: 'grid' } });
    layout().setFocused('c');
    expect(layout().panelRects.get('c')).toMatchObject({ x: 0, w: 60 });
  });

  it('recovers a resized divider from older saved rectangles', () => {
    dragMainDivider(50);
    const state = layout();
    state.restoreLayout(ids, 'a', 'a', getDefaultConfig(ids, 'a'), state.panelRects, state.stealFraction);
    layout().setFocused('b');
    expect(layout().panelRects.get('b')?.w).toBe(50);
  });

  it('does not mistake a legacy equal-grid cell width for a resized main divider', () => {
    const rects = new Map(ids.map((id, i) => [id, { x: i * 20, y: 0, w: 20, h: 100 }]));
    layout().restoreLayout(ids, 'a', 'a', { type: 'grid', panelOrder: ids }, rects, layout().stealFraction);
    layout().setFocused('b');
    expect(layout().panelRects.get('b')?.w).toBe(80);
  });

  it.each([6, 8, 12])('keeps the main/sidebar split with %s panels and bottom overflow', count => {
    for (let i = 5; i < count; i++) layout().addPanel(`extra-${i}`);
    dragMainDivider(60);
    layout().setFocused('a');
    expect(layout().panelRects.get('a')).toMatchObject({ w: 60, h: 80 });
    const bottom = layout().layoutConfig!.panelOrder.slice(5).map(id => layout().panelRects.get(id)!);
    expect(bottom[0].x).toBe(0);
    expect(bottom.at(-1)!.x + bottom.at(-1)!.w).toBeCloseTo(60);
    expect(bottom.every(r => r.y === 80 && r.h === 20)).toBe(true);
    const mainWidth = layout().layoutConfig!.mainWidthPercent;
    layout().finishResize('x', [layout().layoutConfig!.panelOrder[5]], []);
    expect(layout().layoutConfig!.mainWidthPercent).toBe(mainWidth);
    expect(layout().stealFraction).toEqual({ x: 0.5, y: 0.5 });
  });

  it.each([[undefined, 80], [NaN, 80], [Infinity, 80], [-5, 10], [100, 90]])(
    'safely normalizes saved width %s to %s', (saved, expected) => {
      const config = { ...getDefaultConfig(ids, 'a'), mainWidthPercent: saved };
      expect(computeRects(config, 'a', layout().stealFraction).get('a')?.w).toBe(expected);
    },
  );

  it('leaves the existing two-to-four-panel focus sizing unchanged', () => {
    dragMainDivider(35);
    layout().removePanel('e');
    expect(layout().layoutConfig!.type).toBe('quarters');
    expect(layout().panelRects.get('a')).toMatchObject({ w: 75, h: 75 });
    layout().removePanel('d');
    expect(layout().panelRects.get('a')?.w).toBe(75);
    layout().removePanel('c');
    layout().setFocused('b');
    expect(layout().panelRects.get('b')?.w).toBe(75);
  });
});
