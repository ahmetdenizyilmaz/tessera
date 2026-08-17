import { create } from 'zustand';
import { notify } from '../lib/toast';
import type { PanelRect, LayoutConfig, SnapZone, StealFraction } from '../types/session';

// ─── Panel Type ──────────────────────────────────────────────────────────────

export type PanelType = 'terminal' | 'computer' | 'llm' | 'widget' | 'group' | 'plugin';

// ─── Panel Limit ─────────────────────────────────────────────────────────────

export const MAX_PANELS = 12;

/** Check BEFORE creating an instance. Creation is two steps (addInstance,
 *  then addPanel) — if only addPanel refuses, the instance is already in the
 *  store with no tab and lives on invisibly. That is where the orphan pile
 *  came from. */
export function canAddPanel(): boolean {
  return useLayoutStore.getState().tabOrder.length < MAX_PANELS;
}

export function notifyPanelLimit() {
  notify(`Panel limit reached (${MAX_PANELS}). Close a panel first.`);
}

// ─── Sidebar Drag State (module-level, shared between Sidebar & MosaicLayout)
// Anchored to globalThis so it survives Vite HMR module re-evaluation

export const sidebarDragState: {
  kind: string | null;
  startX: number;
  startY: number;
  started: boolean;
  currentSnap: SnapZone | null;
  dragCompleted: boolean;
} = (globalThis as any).__sidebarDragState ??= {
  kind: null,
  startX: 0,
  startY: 0,
  started: false,
  currentSnap: null,
  dragCompleted: false,
};

// ─── Helper: Focus Axis Algorithm ───────────────────────────────────────────

export function focusAxis(
  n: number,
  focusIdx: number,
  stealFraction: number = 0.5,
): number[] {
  if (n <= 0) return [];
  if (n === 1) return [100];

  const base = 100 / n;
  if (focusIdx < 0 || focusIdx >= n) {
    return Array(n).fill(base);
  }

  const result: number[] = new Array(n);
  let taken = 0;
  for (let i = 0; i < n; i++) {
    if (i === focusIdx) continue;
    const give = base * stealFraction;
    result[i] = base - give;
    taken += give;
  }
  result[focusIdx] = base + taken;
  return result;
}

// ─── Compute Rects ──────────────────────────────────────────────────────────

export function computeRects(
  config: LayoutConfig,
  focusedId: string | null,
  stealFraction: StealFraction,
): Map<string, PanelRect> {
  const rects = new Map<string, PanelRect>();
  const order = config.panelOrder;
  const n = order.length;

  if (n === 0) return rects;

  const focusIdx = focusedId ? order.indexOf(focusedId) : -1;

  switch (config.type) {
    case 'single': {
      rects.set(order[0], { x: 0, y: 0, w: 100, h: 100 });
      break;
    }

    case 'split': {
      const dir = config.direction ?? 'left';
      if (dir === 'top' || dir === 'bottom') {
        // Vertical split (top/bottom)
        const [first, second] = dir === 'top' ? [0, 1] : [1, 0];
        const fIdx = focusIdx === -1 ? -1 : (order[focusIdx] === order[first] ? 0 : 1);
        const sizes = focusAxis(2, fIdx, stealFraction.y);
        rects.set(order[first], { x: 0, y: 0, w: 100, h: sizes[0] });
        rects.set(order[second], { x: 0, y: sizes[0], w: 100, h: sizes[1] });
      } else {
        // Horizontal split (left/right)
        const [first, second] = dir === 'left' ? [0, 1] : [1, 0];
        const fIdx = focusIdx === -1 ? -1 : (order[focusIdx] === order[first] ? 0 : 1);
        const sizes = focusAxis(2, fIdx, stealFraction.x);
        rects.set(order[first], { x: 0, y: 0, w: sizes[0], h: 100 });
        rects.set(order[second], { x: sizes[0], y: 0, w: sizes[1], h: 100 });
      }
      break;
    }

    case 'half-stack': {
      const dir = config.direction ?? 'left';
      const mainId = order[0];
      const stack1Id = order[1];
      const stack2Id = order[2];

      // Determine focus groups
      const mainGroupFocus = focusedId === mainId ? 0 : (focusIdx >= 1 ? 1 : -1);
      const stackFocusIdx = focusedId === stack1Id ? 0 : (focusedId === stack2Id ? 1 : -1);

      if (dir === 'left' || dir === 'right') {
        // Main/stack column split → x, stack row split → y
        const colSizes = focusAxis(2, mainGroupFocus, stealFraction.x);
        const rowSizes = focusAxis(2, stackFocusIdx, stealFraction.y);

        if (dir === 'left') {
          rects.set(mainId, { x: 0, y: 0, w: colSizes[0], h: 100 });
          rects.set(stack1Id, { x: colSizes[0], y: 0, w: colSizes[1], h: rowSizes[0] });
          rects.set(stack2Id, { x: colSizes[0], y: rowSizes[0], w: colSizes[1], h: rowSizes[1] });
        } else {
          rects.set(mainId, { x: colSizes[1], y: 0, w: colSizes[0], h: 100 });
          rects.set(stack1Id, { x: 0, y: 0, w: colSizes[1], h: rowSizes[0] });
          rects.set(stack2Id, { x: 0, y: rowSizes[0], w: colSizes[1], h: rowSizes[1] });
        }
      } else {
        // top or bottom — main/stack row split → y, stack column split → x
        const rowSizes = focusAxis(2, mainGroupFocus, stealFraction.y);
        const colSizes = focusAxis(2, stackFocusIdx, stealFraction.x);

        if (dir === 'top') {
          rects.set(mainId, { x: 0, y: 0, w: 100, h: rowSizes[0] });
          rects.set(stack1Id, { x: 0, y: rowSizes[0], w: colSizes[0], h: rowSizes[1] });
          rects.set(stack2Id, { x: colSizes[0], y: rowSizes[0], w: colSizes[1], h: rowSizes[1] });
        } else {
          rects.set(mainId, { x: 0, y: rowSizes[1], w: 100, h: rowSizes[0] });
          rects.set(stack1Id, { x: 0, y: 0, w: colSizes[0], h: rowSizes[1] });
          rects.set(stack2Id, { x: colSizes[0], y: 0, w: colSizes[1], h: rowSizes[1] });
        }
      }
      break;
    }

    case 'three-col': {
      const sizes = focusAxis(3, focusIdx, stealFraction.x);
      let xOffset = 0;
      for (let i = 0; i < 3 && i < n; i++) {
        rects.set(order[i], { x: xOffset, y: 0, w: sizes[i], h: 100 });
        xOffset += sizes[i];
      }
      break;
    }

    case 'quarter-fill': {
      const dir = config.direction ?? 'top-left';
      // 3 panels: two share a row, one fills the other row
      // order: [corner1, corner2, full-row]

      const p1 = order[0];
      const p2 = order[1];
      const p3 = order[2];

      // Focus for rows
      const topRow = dir.startsWith('top') ? [p1, p2] : [p3];
      const bottomRow = dir.startsWith('top') ? [p3] : [p1, p2];
      const focusedIsTop = focusedId ? topRow.includes(focusedId) : false;
      const focusedIsBottom = focusedId ? bottomRow.includes(focusedId) : false;
      const rowFocusIdx = focusedIsTop ? 0 : (focusedIsBottom ? 1 : -1);
      const rowSizes = focusAxis(2, rowFocusIdx, stealFraction.y);

      // Column split for the pair row
      const pairFocusIdx = focusedId === p1 ? 0 : (focusedId === p2 ? 1 : -1);
      const colSizes = focusAxis(2, pairFocusIdx, stealFraction.x);

      if (dir.startsWith('top')) {
        // top pair, bottom full
        rects.set(p1, {
          x: dir.endsWith('left') ? 0 : colSizes[1],
          y: 0,
          w: colSizes[0],
          h: rowSizes[0],
        });
        rects.set(p2, {
          x: dir.endsWith('left') ? colSizes[0] : 0,
          y: 0,
          w: colSizes[1],
          h: rowSizes[0],
        });
        rects.set(p3, { x: 0, y: rowSizes[0], w: 100, h: rowSizes[1] });
      } else {
        // bottom pair, top full
        rects.set(p3, { x: 0, y: 0, w: 100, h: rowSizes[0] });
        rects.set(p1, {
          x: dir.endsWith('left') ? 0 : colSizes[1],
          y: rowSizes[0],
          w: colSizes[0],
          h: rowSizes[1],
        });
        rects.set(p2, {
          x: dir.endsWith('left') ? colSizes[0] : 0,
          y: rowSizes[0],
          w: colSizes[1],
          h: rowSizes[1],
        });
      }
      break;
    }

    case 'quarters': {
      // 2x2 grid: [TL, TR, BL, BR]
      const colFocus = (() => {
        if (focusIdx === -1) return -1;
        return focusIdx % 2 === 0 ? 0 : 1; // 0,2 = left col; 1,3 = right col
      })();
      const rowFocus = (() => {
        if (focusIdx === -1) return -1;
        return focusIdx < 2 ? 0 : 1; // 0,1 = top; 2,3 = bottom
      })();

      const colSizes = focusAxis(2, colFocus, stealFraction.x);
      const rowSizes = focusAxis(2, rowFocus, stealFraction.y);

      if (n >= 1) rects.set(order[0], { x: 0, y: 0, w: colSizes[0], h: rowSizes[0] });
      if (n >= 2) rects.set(order[1], { x: colSizes[0], y: 0, w: colSizes[1], h: rowSizes[0] });
      if (n >= 3) rects.set(order[2], { x: 0, y: rowSizes[0], w: colSizes[0], h: rowSizes[1] });
      if (n >= 4) rects.set(order[3], { x: colSizes[0], y: rowSizes[0], w: colSizes[1], h: rowSizes[1] });
      break;
    }

    // 'grid' is no longer produced, but saved workspaces still contain it.
    // Render those as 'main' so an old layout doesn't come back as equal cells.
    case 'grid':
    case 'main': {
      // 5+ panels: main(80%) + sidebar(20%) + bottom(20%)
      const SIDE = 20;
      const MAX_R = 4;

      const mainId = order[0];
      const sideIds = order.slice(1, 1 + MAX_R);
      const bottomIds = order.slice(1 + MAX_R);

      const hasBottom = bottomIds.length > 0;
      const mainH = hasBottom ? 100 - SIDE : 100;

      // Main panel (top-left area)
      rects.set(mainId, { x: 0, y: 0, w: 100 - SIDE, h: mainH });

      // Sidebar panels (stacked vertically in the right 20%, always full height)
      const sideH = 100 / sideIds.length;
      sideIds.forEach((id, i) => {
        rects.set(id, { x: 100 - SIDE, y: i * sideH, w: SIDE, h: sideH });
      });

      // Bottom panels (equal widths, spanning only the main area width)
      if (hasBottom) {
        const botW = (100 - SIDE) / bottomIds.length;
        bottomIds.forEach((id, i) => {
          rects.set(id, { x: i * botW, y: mainH, w: botW, h: SIDE });
        });
      }
      break;
    }

  }

  return rects;
}

// ─── Gutter Detection ───────────────────────────────────────────────────────

export interface Gutter {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
  panelsBefore: string[];
  panelsAfter: string[];
}

export function computeGutters(rects: Map<string, PanelRect>): Gutter[] {
  const gutters: Gutter[] = [];
  const ids = Array.from(rects.keys());
  const TOLERANCE = 1;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const aId = ids[i];
      const bId = ids[j];
      const a = rects.get(aId)!;
      const b = rects.get(bId)!;

      // Vertical gutter: A's right edge == B's left edge
      if (Math.abs((a.x + a.w) - b.x) < TOLERANCE) {
        const overlapStart = Math.max(a.y, b.y);
        const overlapEnd = Math.min(a.y + a.h, b.y + b.h);
        if (overlapEnd - overlapStart > TOLERANCE) {
          gutters.push({
            axis: 'x',
            position: a.x + a.w,
            start: overlapStart,
            end: overlapEnd,
            panelsBefore: [aId],
            panelsAfter: [bId],
          });
        }
      }
      // Also check reverse
      if (Math.abs((b.x + b.w) - a.x) < TOLERANCE) {
        const overlapStart = Math.max(a.y, b.y);
        const overlapEnd = Math.min(a.y + a.h, b.y + b.h);
        if (overlapEnd - overlapStart > TOLERANCE) {
          gutters.push({
            axis: 'x',
            position: b.x + b.w,
            start: overlapStart,
            end: overlapEnd,
            panelsBefore: [bId],
            panelsAfter: [aId],
          });
        }
      }

      // Horizontal gutter: A's bottom edge == B's top edge
      if (Math.abs((a.y + a.h) - b.y) < TOLERANCE) {
        const overlapStart = Math.max(a.x, b.x);
        const overlapEnd = Math.min(a.x + a.w, b.x + b.w);
        if (overlapEnd - overlapStart > TOLERANCE) {
          gutters.push({
            axis: 'y',
            position: a.y + a.h,
            start: overlapStart,
            end: overlapEnd,
            panelsBefore: [aId],
            panelsAfter: [bId],
          });
        }
      }
      // Reverse
      if (Math.abs((b.y + b.h) - a.y) < TOLERANCE) {
        const overlapStart = Math.max(a.x, b.x);
        const overlapEnd = Math.min(a.x + a.w, b.x + b.w);
        if (overlapEnd - overlapStart > TOLERANCE) {
          gutters.push({
            axis: 'y',
            position: b.y + b.h,
            start: overlapStart,
            end: overlapEnd,
            panelsBefore: [bId],
            panelsAfter: [aId],
          });
        }
      }
    }
  }

  // Merge gutters at same position on same axis
  const merged: Gutter[] = [];
  for (const g of gutters) {
    const existing = merged.find(
      (m) => m.axis === g.axis && Math.abs(m.position - g.position) < TOLERANCE,
    );
    if (existing) {
      for (const id of g.panelsBefore) {
        if (!existing.panelsBefore.includes(id)) existing.panelsBefore.push(id);
      }
      for (const id of g.panelsAfter) {
        if (!existing.panelsAfter.includes(id)) existing.panelsAfter.push(id);
      }
      existing.start = Math.min(existing.start, g.start);
      existing.end = Math.max(existing.end, g.end);
    } else {
      merged.push({ ...g });
    }
  }

  return merged;
}

// ─── Default Config Selection ───────────────────────────────────────────────

export function getDefaultConfig(
  tabOrder: string[],
  focusedId: string | null,
): LayoutConfig {
  const n = tabOrder.length;
  if (n <= 1) {
    return { type: 'single', panelOrder: tabOrder.slice(0, 1) };
  }
  if (n === 2) {
    return { type: 'split', direction: 'left', panelOrder: [...tabOrder] };
  }
  if (n === 3) {
    return { type: 'half-stack', direction: 'left', panelOrder: [...tabOrder] };
  }
  if (n === 4) {
    return { type: 'quarters', panelOrder: [...tabOrder] };
  }
  // 5+: main layout, focused panel promoted to the large slot. The overflow
  // past the four sidebar slots goes to a bottom strip (see the 'main' case in
  // computeRects), so the focused panel keeps its size as the count grows.
  // An equal-cell grid was tried here for 6+ and was wrong: it dropped the
  // main/sidebar arrangement entirely the moment a sixth panel opened.
  const order = [...tabOrder];
  if (focusedId && order.includes(focusedId)) {
    const idx = order.indexOf(focusedId);
    order.splice(idx, 1);
    order.unshift(focusedId);
  }
  return { type: 'main', panelOrder: order };
}

// ─── Build Snap Config ──────────────────────────────────────────────────────

export function buildSnapConfig(
  tabOrder: string[],
  snappedId: string,
  zone: SnapZone,
  currentConfig: LayoutConfig | null,
): LayoutConfig {
  const others = tabOrder.filter((id) => id !== snappedId);
  const n = tabOrder.length;

  if (n === 2) {
    const dir = zone === 'center' ? 'left' : zone;
    return {
      type: 'split',
      direction: dir,
      panelOrder: [snappedId, others[0]],
    };
  }

  if (n === 3) {
    if (zone === 'left' || zone === 'right' || zone === 'top' || zone === 'bottom') {
      return {
        type: 'half-stack',
        direction: zone,
        panelOrder: [snappedId, ...others],
      };
    }
    if (zone === 'center') {
      return {
        type: 'three-col',
        panelOrder: [others[0], snappedId, others[1]],
      };
    }
    // corner zones → quarter-fill
    return {
      type: 'quarter-fill',
      direction: zone,
      panelOrder: [snappedId, ...others],
    };
  }

  if (n === 4) {
    // Convert to quarters, swap snappedId to target quadrant
    const existing = currentConfig?.type === 'quarters'
      ? [...currentConfig.panelOrder]
      : [...tabOrder];

    const quadrantMap: Record<string, number> = {
      'top-left': 0,
      'top-right': 1,
      'top': 0,
      'bottom-left': 2,
      'bottom-right': 3,
      'bottom': 2,
      'left': 0,
      'right': 1,
      'center': 0,
    };
    const targetIdx = quadrantMap[zone] ?? 0;
    const currentIdx = existing.indexOf(snappedId);

    if (currentIdx !== -1 && currentIdx !== targetIdx) {
      const temp = existing[targetIdx];
      existing[targetIdx] = existing[currentIdx];
      existing[currentIdx] = temp;
    }

    return { type: 'quarters', panelOrder: existing };
  }

  // 5+: main layout with the snapped panel as main
  return { type: 'main', panelOrder: [snappedId, ...others] };
}

// ─── Snap Zone Detection ────────────────────────────────────────────────────

export function detectSnapZone(
  mouseX: number,
  mouseY: number,
  containerWidth: number,
  containerHeight: number,
  panelCount: number,
): SnapZone | null {
  if (containerWidth === 0 || containerHeight === 0) return null;

  const mx = mouseX / containerWidth;
  const my = mouseY / containerHeight;

  if (panelCount === 2) {
    if (mx < 0.5) {
      return mx < my && mx < (1 - my) ? 'left' : (my < 0.5 ? 'top' : 'bottom');
    } else {
      return (1 - mx) < my && (1 - mx) < (1 - my) ? 'right' : (my < 0.5 ? 'top' : 'bottom');
    }
  }

  if (panelCount === 3) {
    const col = mx < 0.33 ? 0 : mx < 0.67 ? 1 : 2;
    const row = my < 0.33 ? 0 : my < 0.67 ? 1 : 2;
    const zones: SnapZone[][] = [
      ['top-left', 'top', 'top-right'],
      ['left', 'center', 'right'],
      ['bottom-left', 'bottom', 'bottom-right'],
    ];
    return zones[row][col];
  }

  if (panelCount === 4) {
    if (mx < 0.5) {
      return my < 0.5 ? 'top-left' : 'bottom-left';
    } else {
      return my < 0.5 ? 'top-right' : 'bottom-right';
    }
  }

  if (panelCount >= 5) {
    const distances: [SnapZone, number][] = [
      ['left', mx],
      ['right', 1 - mx],
      ['top', my],
      ['bottom', 1 - my],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  }

  return null;
}

// ─── Derive Steal Fraction ──────────────────────────────────────────────────

export function deriveStealFraction(
  config: LayoutConfig,
  focusedId: string | null,
  currentRects: Map<string, PanelRect>,
  gutterAxis: 'x' | 'y',
): number {
  if (!focusedId) return 0.5;
  const focusedRect = currentRects.get(focusedId);
  if (!focusedRect) return 0.5;

  const focusedSize = gutterAxis === 'x' ? focusedRect.w : focusedRect.h;
  const numGroups = config.type === 'three-col' && gutterAxis === 'x' ? 3 : 2;
  const equalBase = 100 / numGroups;
  const bigSide = Math.max(focusedSize, 100 - focusedSize);

  if (Math.abs(bigSide - equalBase) < 1) return 0.5;

  const otherBases = 100 - equalBase;
  const newFraction = (bigSide - equalBase) / otherBases;
  return Math.max(0.05, Math.min(0.9, newFraction));
}

// ─── Layout Store ───────────────────────────────────────────────────────────
// Layout persistence is owned by lib/workspaceSerializer.ts (the single
// source of truth for the whole workspace).

interface LayoutState {
  layout: string | null;
  tabOrder: string[];
  activeTabId: string | null;
  focusedId: string | null;
  /** When set, only this panel is shown; the rest stay mounted but hidden and
   *  are reached through the tab bar. Not persisted — a workspace reopens with
   *  the full mosaic visible. */
  maximizedId: string | null;
  layoutConfig: LayoutConfig | null;
  panelRects: Map<string, PanelRect>;
  stealFraction: StealFraction;
  panelTypes: Record<string, PanelType>;
  widgetKinds: Record<string, string>;
  sidebarDragging: boolean;
  sidebarDragSnap: SnapZone | null;
  dragReturnToSidebar: boolean;

  setSidebarDrag: (dragging: boolean, snap: SnapZone | null) => void;
  setDragReturnToSidebar: (returning: boolean) => void;
  addPanel: (id: string, type?: PanelType) => void;
  addWidgetPanel: (kind: string, zone?: SnapZone) => string;
  removePanel: (id: string) => void;
  restoreLayout: (
    tabOrder: string[],
    activeTabId: string | null,
    focusedId: string | null,
    layoutConfig: LayoutConfig | null,
    panelRects: Map<string, PanelRect>,
    stealFraction: StealFraction,
    panelTypes?: Record<string, PanelType>,
    widgetKinds?: Record<string, string>,
  ) => void;
  setActiveTab: (id: string | null) => void;
  setFocused: (id: string | null) => void;
  cycleFocus: (delta: 1 | -1) => void;
  toggleMaximized: (id: string) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
  setPanelRect: (id: string, rect: PanelRect) => void;
  setRawPanelRects: (rects: Map<string, PanelRect>) => void;
  finishResize: (gutterAxis: 'x' | 'y', gutterBefore: string[], gutterAfter: string[]) => void;
  resetStealFraction: () => void;
  clearPanelRects: () => void;
  applySnap: (snappedId: string, zone: SnapZone) => void;
}

function recompute(
  tabOrder: string[],
  focusedId: string | null,
  stealFraction: StealFraction,
  currentConfig: LayoutConfig | null,
): { layoutConfig: LayoutConfig; panelRects: Map<string, PanelRect> } {
  const config = currentConfig && currentConfig.panelOrder.length === tabOrder.length
    ? { ...currentConfig, panelOrder: [...tabOrder] }
    : getDefaultConfig(tabOrder, focusedId);
  const rects = computeRects(config, focusedId, stealFraction);
  return { layoutConfig: config, panelRects: rects };
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  layout: null,
  tabOrder: [],
  activeTabId: null,
  focusedId: null,
  maximizedId: null,
  layoutConfig: null,
  panelRects: new Map(),
  stealFraction: { x: 0.5, y: 0.5 },
  panelTypes: {},
  widgetKinds: {},
  sidebarDragging: false,
  sidebarDragSnap: null,
  dragReturnToSidebar: false,

  setSidebarDrag: (dragging, snap) => set({ sidebarDragging: dragging, sidebarDragSnap: snap }),
  setDragReturnToSidebar: (returning) => set({ dragReturnToSidebar: returning }),

  addPanel: (id: string, type: PanelType = 'terminal') => {
    const state = get();
    if (state.tabOrder.includes(id)) return;
    if (state.tabOrder.length >= MAX_PANELS) {
      console.warn(`Panel limit reached (${MAX_PANELS}); cannot add panel ${id}`);
      notifyPanelLimit();
      return;
    }

    const newOrder = [...state.tabOrder, id];
    const newTypes = { ...state.panelTypes, [id]: type };
    const { layoutConfig, panelRects } = recompute(
      newOrder,
      id,
      state.stealFraction,
      null, // Force new default config when panel count changes
    );

    const newState = {
      layout: newOrder[0] ?? null,
      tabOrder: newOrder,
      activeTabId: id,
      focusedId: id,
      layoutConfig,
      panelRects,
      panelTypes: newTypes,
    };
    set(newState);  },

  addWidgetPanel: (kind: string, zone?: SnapZone) => {
    const state = get();
    // Prevent duplicate widget panels of the same kind
    const alreadyOpen = Object.values(state.widgetKinds).includes(kind);
    if (alreadyOpen) {
      // Focus the existing panel instead
      const existingId = Object.entries(state.widgetKinds).find(([, k]) => k === kind)?.[0];
      if (existingId) {
        set({ activeTabId: existingId, focusedId: existingId });
      }
      return '';
    }
    if (state.tabOrder.length >= MAX_PANELS) {
      console.warn(`Panel limit reached (${MAX_PANELS}); cannot add widget ${kind}`);
      notifyPanelLimit();
      return '';
    }
    const id = `widget-${kind}-${Date.now()}`;

    const newOrder = [...state.tabOrder, id];
    const newTypes = { ...state.panelTypes, [id]: 'widget' as PanelType };
    const newWidgetKinds = { ...state.widgetKinds, [id]: kind };

    let layoutConfig: LayoutConfig;
    let panelRects: Map<string, PanelRect>;

    if (zone && newOrder.length >= 2) {
      layoutConfig = buildSnapConfig(newOrder, id, zone, null);
      panelRects = computeRects(layoutConfig, id, state.stealFraction);
    } else {
      const result = recompute(newOrder, id, state.stealFraction, null);
      layoutConfig = result.layoutConfig;
      panelRects = result.panelRects;
    }

    const newState = {
      layout: newOrder[0] ?? null,
      tabOrder: newOrder,
      activeTabId: id,
      focusedId: id,
      layoutConfig,
      panelRects,
      panelTypes: newTypes,
      widgetKinds: newWidgetKinds,
    };
    set(newState);    return id;
  },

  removePanel: (id: string) => {
    const state = get();
    const newOrder = state.tabOrder.filter((t) => t !== id);
    const newTypes = { ...state.panelTypes };
    delete newTypes[id];
    const newWidgetKinds = { ...state.widgetKinds };
    delete newWidgetKinds[id];

    const newFocused = state.focusedId === id
      ? (newOrder[0] ?? null)
      : state.focusedId;
    const newActive = state.activeTabId === id
      ? (newOrder[0] ?? null)
      : state.activeTabId;
    // Closing the maximized panel drops back to the mosaic rather than
    // silently maximizing whichever panel inherited focus.
    const newMaximized = state.maximizedId === id ? null : state.maximizedId;

    if (newOrder.length === 0) {
      const newState = {
        layout: null,
        tabOrder: [],
        activeTabId: null,
        focusedId: null,
        maximizedId: null,
        layoutConfig: null,
        panelRects: new Map<string, PanelRect>(),
        // Keep panelTypes & widgetKinds — they hold type info for panels
        // in other groups that aren't currently visible in tabOrder
        panelTypes: newTypes,
        widgetKinds: newWidgetKinds,
      };
      set(newState);
      return;
    }

    const { layoutConfig, panelRects } = recompute(
      newOrder,
      newFocused,
      state.stealFraction,
      null,
    );

    const newState = {
      layout: newOrder[0] ?? null,
      tabOrder: newOrder,
      activeTabId: newActive,
      focusedId: newFocused,
      maximizedId: newMaximized,
      layoutConfig,
      panelRects,
      panelTypes: newTypes,
      widgetKinds: newWidgetKinds,
    };
    set(newState);  },

  restoreLayout: (tabOrder, activeTabId, focusedId, layoutConfig, panelRects, stealFraction, panelTypes, widgetKinds) => {
    set({
      layout: tabOrder[0] ?? null,
      tabOrder,
      activeTabId,
      focusedId,
      layoutConfig,
      panelRects,
      stealFraction,
      panelTypes: panelTypes ?? {},
      widgetKinds: widgetKinds ?? {},
    });  },

  setActiveTab: (id: string | null) => {
    // While maximized, picking a tab swaps which panel fills the area rather
    // than dropping back to the mosaic — the tab bar is the navigation.
    const { maximizedId } = get();
    if (maximizedId && id) {
      set({ activeTabId: id, maximizedId: id });
      get().setFocused(id);
      return;
    }
    set({ activeTabId: id });
  },

  toggleMaximized: (id: string) => {
    const state = get();
    if (state.maximizedId === id) {
      set({ maximizedId: null });
      return;
    }
    set({ maximizedId: id, activeTabId: id });
    state.setFocused(id);
  },

  /// Move focus to the next (+1) or previous (-1) panel in tab-strip order,
  /// wrapping around. Does exactly what clicking that tab does, so the 'main'
  /// layout still promotes the newly focused panel to the large slot.
  cycleFocus: (delta: 1 | -1) => {
    const state = get();
    const order = state.tabOrder;
    if (order.length < 2) return;

    const current = state.focusedId ?? state.activeTabId;
    const currentIdx = current ? order.indexOf(current) : -1;
    // Nothing focused yet: step in from whichever end matches the direction.
    const nextIdx =
      currentIdx === -1
        ? (delta === 1 ? 0 : order.length - 1)
        : (currentIdx + delta + order.length) % order.length;

    const nextId = order[nextIdx];
    set({ activeTabId: nextId });
    get().setFocused(nextId);
  },

  setFocused: (id: string | null) => {
    const state = get();
    if (!state.layoutConfig) return;

    let config = state.layoutConfig;

    // For 'main' layout: promote focused panel to order[0] (the large main panel)
    if (config.type === 'main' && id && config.panelOrder[0] !== id) {
      const order = [...config.panelOrder];
      const idx = order.indexOf(id);
      if (idx > 0) {
        order.splice(idx, 1);
        order.unshift(id);
        config = { ...config, panelOrder: order };
      }
    }

    const rects = computeRects(config, id, state.stealFraction);
    set({ focusedId: id, layoutConfig: config, panelRects: rects });  },

  moveTab: (fromIndex: number, toIndex: number) => {
    const state = get();
    const newOrder = [...state.tabOrder];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);

    // Only the tab strip's display order changes — layoutConfig.panelOrder
    // stays authoritative for geometry, so reordering tabs never destroys
    // a snap arrangement.
    set({ tabOrder: newOrder });  },

  setPanelRect: (id: string, rect: PanelRect) => {
    set((state) => {
      const next = new Map(state.panelRects);
      next.set(id, rect);
      return { panelRects: next };
    });
  },

  setRawPanelRects: (rects: Map<string, PanelRect>) => {
    set({ panelRects: rects });
  },

  finishResize: (gutterAxis: 'x' | 'y', _gutterBefore: string[], _gutterAfter: string[]) => {
    const state = get();
    if (!state.layoutConfig) return;

    const newFraction = deriveStealFraction(
      state.layoutConfig,
      state.focusedId,
      state.panelRects,
      gutterAxis,
    );

    // Only the dragged axis updates — the cross axis keeps its fraction
    set({ stealFraction: { ...state.stealFraction, [gutterAxis]: newFraction } });  },

  resetStealFraction: () => {
    const state = get();
    if (!state.layoutConfig) return;

    const reset = { x: 0.5, y: 0.5 };
    const rects = computeRects(state.layoutConfig, state.focusedId, reset);
    set({ stealFraction: reset, panelRects: rects });  },

  clearPanelRects: () => {
    set({ panelRects: new Map() });
  },

  applySnap: (snappedId: string, zone: SnapZone) => {
    const state = get();
    const config = buildSnapConfig(state.tabOrder, snappedId, zone, state.layoutConfig);
    const rects = computeRects(config, state.focusedId, state.stealFraction);

    set({ layoutConfig: config, panelRects: rects });  },
}));
