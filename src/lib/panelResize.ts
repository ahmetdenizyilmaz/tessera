import type { Gutter } from '../store/layoutStore';
import type { PanelRect } from '../types/session';

/** Resize the rectangular groups on either side of a divider. A main-panel
 * edge also bounds the footer: scale that whole row instead of squeezing only
 * its last (often tiny) panel until it prevents the divider from moving. */
export function resizePanels(rects: Map<string, PanelRect>, gutter: Gutter, requestedDelta: number): Map<string, PanelRect> {
  if (!Number.isFinite(requestedDelta)) return rects;
  const horizontal = gutter.axis === 'x';
  const position = (r: PanelRect) => horizontal ? r.x : r.y;
  const size = (r: PanelRect) => horizontal ? r.w : r.h;
  const cross = (r: PanelRect) => horizontal ? r.y : r.x;
  const crossSize = (r: PanelRect) => horizontal ? r.h : r.w;
  const before = gutter.panelsBefore.map(id => rects.get(id));
  const after = gutter.panelsAfter.map(id => rects.get(id));
  if (!before.length || !after.length || [...before, ...after].some(r => !r)) return rects;
  const start = Math.min(...before.map(r => position(r!)));
  const end = Math.max(...after.map(r => position(r!) + size(r!)));
  const beforeSize = gutter.position - start, afterSize = end - gutter.position;
  if (beforeSize <= 0 || afterSize <= 0) return rects;
  // A 10%-of-workspace minimum cannot fit two narrow footer slots. Limit it
  // to one quarter of the space shared by this pair, without jumping on grab.
  const minimum = Math.min(10, (end - start) / 4);
  const delta = Math.max(Math.min(minimum, beforeSize) - beforeSize,
    Math.min(afterSize - Math.min(minimum, afterSize), requestedDelta));
  const result = new Map(rects);
  for (const [id, r] of rects) {
    if (cross(r) < gutter.start - .0001 || cross(r) + crossSize(r) > gutter.end + .0001) continue;
    const p = position(r), s = size(r);
    let nextPosition: number, nextSize: number;
    if (p >= start - .0001 && p + s <= gutter.position + .0001) {
      const scale = (beforeSize + delta) / beforeSize;
      nextPosition = start + (p - start) * scale; nextSize = s * scale;
    } else if (p >= gutter.position - .0001 && p + s <= end + .0001) {
      const scale = (afterSize - delta) / afterSize;
      nextPosition = gutter.position + delta + (p - gutter.position) * scale; nextSize = s * scale;
    } else continue;
    result.set(id, horizontal ? { ...r, x: nextPosition, w: nextSize } : { ...r, y: nextPosition, h: nextSize });
  }
  return result;
}

export function samePanelRect(a: PanelRect | undefined, b: PanelRect | undefined): boolean {
  return !!a && !!b && (['x', 'y', 'w', 'h'] as const).every(key => Math.abs(a[key] - b[key]) < .0001);
}
