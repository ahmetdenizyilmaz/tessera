import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
  useLayoutStore,
  computeGutters,
  computeRects,
  buildSnapConfig,
  detectSnapZone,
  type Gutter,
} from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import type { PanelRect, SnapZone } from '../../types/session';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { ComputerPanel } from '../computer/ComputerPanel';
import { LlmPanel } from '../llm/LlmPanel';
import { WidgetPanel } from '../widget/WidgetPanel';
import { GroupPreview } from '../groups/GroupPreview';
import { PluginPanel } from '../plugins/PluginPanel';
import { SnapZoneOverlay } from './SnapZoneOverlay';

const EMPTY_TAB_ORDER: string[] = [];
const EMPTY_RECTS = new Map<string, PanelRect>();
const MIN_PANEL_PCT = 10;
const DRAG_THRESHOLD = 6;
const GAP = 3;

export function MosaicLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabOrder = useLayoutStore((s) => s.tabOrder ?? EMPTY_TAB_ORDER);
  const focusedId = useLayoutStore((s) => s.focusedId);
  const maximizedId = useLayoutStore((s) => s.maximizedId);
  const panelRects = useLayoutStore((s) => s.panelRects ?? EMPTY_RECTS);
  const layoutConfig = useLayoutStore((s) => s.layoutConfig);
  const stealFraction = useLayoutStore((s) => s.stealFraction);
  const setRawPanelRects = useLayoutStore((s) => s.setRawPanelRects);
  const finishResize = useLayoutStore((s) => s.finishResize);
  const setFocused = useLayoutStore((s) => s.setFocused);
  const applySnap = useLayoutStore((s) => s.applySnap);
  const resetStealFraction = useLayoutStore((s) => s.resetStealFraction);
  const panelTypes = useLayoutStore((s) => s.panelTypes);

  const sidebarDragging = useLayoutStore((s) => s.sidebarDragging);
  const sidebarDragSnap = useLayoutStore((s) => s.sidebarDragSnap);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeSnap, setActiveSnap] = useState<SnapZone | null>(null);
  const [resizing, setResizing] = useState(false);
  const [gutterDragging, setGutterDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs to always hold latest values (avoid stale closures in global listeners)
  const tabOrderRef = useRef(tabOrder); tabOrderRef.current = tabOrder;
  const layoutConfigRef = useRef(layoutConfig); layoutConfigRef.current = layoutConfig;
  const setFocusedRef = useRef(setFocused); setFocusedRef.current = setFocused;
  const applySnapRef = useRef(applySnap); applySnapRef.current = applySnap;
  const setRawPanelRectsRef = useRef(setRawPanelRects); setRawPanelRectsRef.current = setRawPanelRects;
  const finishResizeRef = useRef(finishResize); finishResizeRef.current = finishResize;

  const dragState = useRef<{
    panelId: string;
    startX: number;
    startY: number;
    started: boolean;
    currentSnap: SnapZone | null;
    returnToSidebar: boolean;
  } | null>(null);

  const resizeRef = useRef<{
    gutter: Gutter;
    startPos: number;
    startRects: Map<string, PanelRect>;
  } | null>(null);

  // Track container dimensions for snap zone overlay
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ─── Group enter/exit panel animation ──────────────────────────────
  const transitionDirection = useGroupStore((s) => s.transitionDirection);
  const transitionGroupId = useGroupStore((s) => s.transitionGroupId);
  const [enterAnim, setEnterAnim] = useState<string | null>(null);
  const [exitAnim, setExitAnim] = useState<{ groupId: string; phase: 'collapse' | 'expand' } | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Enter: animate group to full-screen, then commit layout swap
  useEffect(() => {
    if (transitionDirection !== 'enter' || !transitionGroupId) return;
    setExitAnim(null);
    setEnterAnim(transitionGroupId);
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    enterTimerRef.current = setTimeout(() => {
      useGroupStore.getState().commitEnterGroup();
      setEnterAnim(null);
      enterTimerRef.current = null;
    }, 300);
    return () => {
      if (enterTimerRef.current) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
    };
  }, [transitionDirection, transitionGroupId]);

  // Exit: layout already swapped — collapse all to group position, then expand
  useEffect(() => {
    if (transitionDirection !== 'exit' || !transitionGroupId) return;
    setEnterAnim(null);
    if (enterTimerRef.current) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
    let cancelled = false;
    setExitAnim({ groupId: transitionGroupId, phase: 'collapse' });
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        setExitAnim((prev) => prev ? { ...prev, phase: 'expand' } : null);
        setTimeout(() => {
          if (cancelled) return;
          setExitAnim(null);
          useGroupStore.getState().clearTransition();
        }, 300);
      });
    });
    return () => { cancelled = true; };
  }, [transitionDirection, transitionGroupId]);

  const isAnimating = enterAnim !== null || exitAnim !== null;

  // Block pointer events during resize animation
  const startResizeLock = useCallback(() => {
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    setResizing(true);
    resizeTimer.current = setTimeout(() => setResizing(false), 270);
  }, []);

  useEffect(() => () => {
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
  }, []);

  // Display rects: preview snap layout during drag
  const sidebarSlotFractions = useLayoutStore((s) => s.sidebarSlotFractions);
  const displayRects = useMemo((): Map<string, PanelRect> => {
    if (draggingId && layoutConfig) {
      if (activeSnap) {
        const preview = buildSnapConfig(tabOrder, draggingId, activeSnap, layoutConfig);
        return computeRects(preview, focusedId, stealFraction, sidebarSlotFractions);
      }
      return computeRects(layoutConfig, focusedId, stealFraction, sidebarSlotFractions);
    }
    return panelRects;
  }, [draggingId, activeSnap, tabOrder, layoutConfig, panelRects, stealFraction, focusedId, sidebarSlotFractions]);

  // Override rects during group enter/exit animation
  const animatedRects = useMemo((): Map<string, PanelRect> => {
    // Enter: group expands to full, others collapse to group center
    if (enterAnim) {
      const groupRect = displayRects.get(enterAnim);
      if (!groupRect) return displayRects;
      const cx = groupRect.x + groupRect.w / 2;
      const cy = groupRect.y + groupRect.h / 2;
      const result = new Map<string, PanelRect>();
      for (const [id] of displayRects) {
        if (id === enterAnim) {
          result.set(id, { x: 0, y: 0, w: 100, h: 100 });
        } else {
          result.set(id, { x: cx, y: cy, w: 0, h: 0 });
        }
      }
      return result;
    }
    // Exit collapse: all panels start at group position (shown for 1 frame, no transition)
    if (exitAnim?.phase === 'collapse') {
      const groupRect = displayRects.get(exitAnim.groupId);
      if (!groupRect) return displayRects;
      const cx = groupRect.x + groupRect.w / 2;
      const cy = groupRect.y + groupRect.h / 2;
      const result = new Map<string, PanelRect>();
      for (const [id] of displayRects) {
        if (id === exitAnim.groupId) {
          result.set(id, { x: 0, y: 0, w: 100, h: 100 });
        } else {
          result.set(id, { x: cx, y: cy, w: 0, h: 0 });
        }
      }
      return result;
    }
    // Exit expand or no animation: real rects
    return displayRects;
  }, [displayRects, enterAnim, exitAnim]);

  // Gutters (shared borders) for resize handles -- skip during drag or animation
  const gutters = useMemo(() => {
    // Nothing to resize against while one panel fills the area.
    if (draggingId || isAnimating || maximizedId) return [];
    return computeGutters(displayRects);
  }, [displayRects, draggingId, isAnimating, maximizedId]);

  // Gutter resize start
  const handleGutterDown = useCallback((e: React.PointerEvent, gutter: Gutter) => {
    e.stopPropagation();
    e.preventDefault();
    const currentRects = useLayoutStore.getState().panelRects;
    resizeRef.current = {
      gutter,
      startPos: gutter.axis === 'x' ? e.clientX : e.clientY,
      startRects: new Map(currentRects),
    };
    setGutterDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = gutter.axis === 'x' ? 'col-resize' : 'row-resize';
  }, []);

  // Pointer-down: start drag OR focus
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;

    // Don't interfere with resize handles
    if (target.closest('.resize-handle, .mosaic-gutter')) return;

    // For interactive elements (buttons, inputs), just let the click through
    // without focusing or resizing — so close buttons work on unfocused panels
    if (target.closest('button, input, select, textarea')) return;

    const panel = target.closest('[data-panel-id]') as HTMLElement | null;
    if (!panel) return;
    const panelId = panel.dataset.panelId!;

    // For group panels, always enter on click (focused or not)
    const currentPanelType = useLayoutStore.getState().panelTypes[panelId];
    if (currentPanelType === 'group') {
      useGroupStore.getState().enterGroup(panelId);
      return;
    }

    // If clicking the unfocused overlay, just focus the panel
    if (target.classList.contains('unfocused-overlay')) {
      startResizeLock();
      setFocused(panelId);
      return;
    }

    const toolbar = target.closest('.terminal-toolbar');

    // Start drag from toolbar
    if (toolbar) {
      dragState.current = {
        panelId,
        startX: e.clientX,
        startY: e.clientY,
        started: false,
        currentSnap: null,
        returnToSidebar: false,
      };
      return;
    }

    // Otherwise just focus
    startResizeLock();
    setFocused(panelId);
  }, [setFocused, startResizeLock]);

  // Global pointer listeners for drag and resize
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Gutter resize
      const rs = resizeRef.current;
      if (rs) {
        const c = containerRef.current;
        if (!c) return;
        const b = c.getBoundingClientRect();
        const containerDim = rs.gutter.axis === 'x' ? b.width : b.height;
        const mousePos = rs.gutter.axis === 'x' ? e.clientX : e.clientY;
        const deltaPx = mousePos - rs.startPos;
        let delta = (deltaPx / containerDim) * 100;

        // Clamp so no panel goes below MIN_PANEL_PCT
        for (const id of rs.gutter.panelsBefore) {
          const r = rs.startRects.get(id)!;
          const size = rs.gutter.axis === 'x' ? r.w : r.h;
          if (size + delta < MIN_PANEL_PCT) delta = MIN_PANEL_PCT - size;
        }
        for (const id of rs.gutter.panelsAfter) {
          const r = rs.startRects.get(id)!;
          const size = rs.gutter.axis === 'x' ? r.w : r.h;
          if (size - delta < MIN_PANEL_PCT) delta = size - MIN_PANEL_PCT;
        }

        const newRects = new Map(rs.startRects);
        for (const id of rs.gutter.panelsBefore) {
          const r = rs.startRects.get(id)!;
          if (rs.gutter.axis === 'x') {
            newRects.set(id, { ...r, w: r.w + delta });
          } else {
            newRects.set(id, { ...r, h: r.h + delta });
          }
        }
        for (const id of rs.gutter.panelsAfter) {
          const r = rs.startRects.get(id)!;
          if (rs.gutter.axis === 'x') {
            newRects.set(id, { ...r, x: r.x + delta, w: r.w - delta });
          } else {
            newRects.set(id, { ...r, y: r.y + delta, h: r.h - delta });
          }
        }
        setRawPanelRectsRef.current(newRects);
        return;
      }

      // Panel drag
      const ds = dragState.current;
      if (ds) {
        if (!ds.started) {
          if (Math.abs(e.clientX - ds.startX) < DRAG_THRESHOLD &&
              Math.abs(e.clientY - ds.startY) < DRAG_THRESHOLD) return;
          ds.started = true;
          setDraggingId(ds.panelId);
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'grabbing';
        }

        // Detect drag-to-sidebar for widget panels
        const panelType = useLayoutStore.getState().panelTypes[ds.panelId];
        const isWidget = panelType === 'widget';
        if (isWidget && e.clientX < 50) {
          ds.returnToSidebar = true;
          ds.currentSnap = null;
          setActiveSnap(null);
          useLayoutStore.getState().setDragReturnToSidebar(true);
          return;
        }
        if (ds.returnToSidebar) {
          ds.returnToSidebar = false;
          useLayoutStore.getState().setDragReturnToSidebar(false);
        }

        const c = containerRef.current;
        if (!c) return;
        const b = c.getBoundingClientRect();
        const zone = detectSnapZone(
          e.clientX - b.left, e.clientY - b.top,
          b.width, b.height,
          tabOrderRef.current.length,
        );
        ds.currentSnap = zone;
        setActiveSnap(zone);
        return;
      }

      // Sidebar widget drag is now handled by Sidebar component directly
    };

    const onUp = () => {
      // Gutter resize end
      if (resizeRef.current) {
        const { gutter } = resizeRef.current;
        resizeRef.current = null;
        setGutterDragging(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        window.getSelection()?.removeAllRanges();
        finishResizeRef.current(gutter.axis, gutter.panelsBefore, gutter.panelsAfter);
        return;
      }

      // Panel drag end
      const ds = dragState.current;
      if (ds) {
        if (ds.started && ds.returnToSidebar) {
          // Widget panel dragged back to sidebar - remove it
          startResizeLock();
          useLayoutStore.getState().removePanel(ds.panelId);
          useLayoutStore.getState().setDragReturnToSidebar(false);
        } else if (ds.started && ds.currentSnap) {
          startResizeLock();
          applySnapRef.current(ds.panelId, ds.currentSnap);
        } else if (!ds.started) {
          startResizeLock();
          setFocusedRef.current(ds.panelId);
        }

        dragState.current = null;
        setDraggingId(null);
        setActiveSnap(null);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        return;
      }

      // Sidebar widget drag end is now handled by Sidebar component directly
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [startResizeLock]);

  // Empty state
  if (tabOrder.length === 0) {
    return (
      <div className="mosaic-container">
        <div className="mosaic-empty">
          <div className="mosaic-empty-text">
            Click + to create a new instance
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={'mosaic-container' + (gutterDragging ? ' mosaic-gutter-dragging' : '')}
      onPointerDown={handlePointerDown}
    >
      {/* Panels */}
      {tabOrder.map((id) => {
        const rectFromLayout = animatedRects.get(id);
        if (!rectFromLayout) return null;

        // Maximized: the chosen panel fills the area and the others are hidden
        // rather than unmounted — a terminal that unmounts loses its viewport,
        // and re-mounting would refit every xterm on every toggle.
        const isHidden = maximizedId !== null && maximizedId !== id;
        const rect = maximizedId === id
          ? { x: 0, y: 0, w: 100, h: 100 }
          : rectFromLayout;

        const isFocused = focusedId === id;
        const isDrag = draggingId === id;
        const panelType = panelTypes[id] ?? 'terminal';

        // Animation state for this panel
        const isEnterTarget = enterAnim === id;
        const isExitTarget = exitAnim?.groupId === id;
        const isShrinking = (enterAnim && id !== enterAnim) ||
          (exitAnim?.phase === 'collapse' && id !== exitAnim.groupId);
        const isCollapsePhase = exitAnim?.phase === 'collapse';

        return (
          <div
            key={id}
            data-panel-id={id}
            className={
              'mosaic-tile'
              + (isDrag ? ' mosaic-tile-dragging' : '')
              + (resizing ? ' mosaic-tile-resizing' : '')
              + (isDrag || gutterDragging || isCollapsePhase ? ' no-transition' : '')
            }
            style={{
              position: 'absolute',
              left: `calc(${rect.x}% + ${GAP}px)`,
              top: `calc(${rect.y}% + ${GAP}px)`,
              width: `calc(${rect.w}% - ${GAP * 2}px)`,
              height: `calc(${rect.h}% - ${GAP * 2}px)`,
              zIndex: isDrag ? 50
                : (isEnterTarget || isExitTarget) ? 50
                : isFocused ? 10 : 1,
              transition: isDrag || gutterDragging || isCollapsePhase
                ? 'none'
                : 'left 0.28s ease, top 0.28s ease, width 0.28s ease, height 0.28s ease, opacity 0.2s ease',
              borderRadius: 4,
              overflow: 'hidden',
              border: isFocused
                ? '1px solid rgba(74, 158, 255, 0.3)'
                : '1px solid rgba(255, 255, 255, 0.06)',
              boxSizing: 'border-box',
              opacity: isShrinking ? 0 : 1,
              // visibility, not display:none — a display:none xterm reports a
              // zero-size viewport and its fit addon collapses the terminal.
              visibility: isHidden ? 'hidden' : 'visible',
              pointerEvents: isHidden ? 'none' : undefined,
            }}
          >
            {panelType === 'group'
              ? <GroupPreview groupId={id} />
              : panelType === 'widget'
              ? <WidgetPanel instanceId={id} />
              : panelType === 'computer'
              ? <ComputerPanel instanceId={id} />
              : panelType === 'llm'
              ? <LlmPanel instanceId={id} />
              : panelType === 'plugin'
              ? <PluginPanel instanceId={id} />
              : <TerminalPanel instanceId={id} />
            }
            {/* Unfocused panel overlay: blocks xterm interactions until clicked */}
            {!isFocused && !isDrag && tabOrder.length > 1 && (
              <div className="unfocused-overlay" />
            )}
          </div>
        );
      })}

      {/* Gutter resize handles at panel borders */}
      {gutters.map((g, i) => {
        const isV = g.axis === 'x';
        return (
          <div
            key={`gutter-${i}`}
            className={`mosaic-gutter mosaic-gutter-${g.axis}`}
            style={isV ? {
              position: 'absolute',
              zIndex: 10,
              left: `calc(${g.position}% - 4px)`,
              top: `calc(${g.start}% + ${GAP}px)`,
              width: 8,
              height: `calc(${g.end - g.start}% - ${GAP * 2}px)`,
              cursor: 'col-resize',
            } : {
              position: 'absolute',
              zIndex: 10,
              top: `calc(${g.position}% - 4px)`,
              left: `calc(${g.start}% + ${GAP}px)`,
              width: `calc(${g.end - g.start}% - ${GAP * 2}px)`,
              height: 8,
              cursor: 'row-resize',
            }}
            onPointerDown={(e) => handleGutterDown(e, g)}
            onDoubleClick={(e) => { e.stopPropagation(); resetStealFraction(); }}
          />
        );
      })}

      {/* Snap zone highlight during tab drag or sidebar drag */}
      {((activeSnap && draggingId) || (sidebarDragSnap && sidebarDragging)) && containerSize.width > 0 && (
        <SnapZoneOverlay zone={(sidebarDragging ? sidebarDragSnap : activeSnap)!} containerRect={containerSize} />
      )}
    </div>
  );
}
