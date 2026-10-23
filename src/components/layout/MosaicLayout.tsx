import { PanelAppearance } from '../appearance/PanelAppearance';
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
  useLayoutStore as useMainLayoutStore,
  computeGutters,
  computeSnapLayout,
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
import { RemotePanel } from '../lan/RemotePanel';
import { SnapZoneOverlay } from './SnapZoneOverlay';
import { beginWindowPanelDrag, endWindowPanelDrag, finishWindowTabDrag } from '../../lib/workspaceWindows';
import { useWindowDragStore } from '../../store/windowDragStore';
import { usePanelWindow } from '../windows/PanelWindowContext';
import { beginPanelResize } from '../../lib/layoutHistory';
import { installPanelMaximizeShortcut } from '../../lib/panelMaximize';
import { resizePanels, samePanelRect } from '../../lib/panelResize';
import { usePanelLockStore } from '../../store/panelLockStore';
import { useInstanceStore } from '../../store/instanceStore';

const EMPTY_TAB_ORDER: string[] = [];
const EMPTY_RECTS = new Map<string, PanelRect>();
const DRAG_THRESHOLD = 6;
const GAP = 3;

export function MosaicLayout() {
  const panelWindow = usePanelWindow();
  const useLayoutStore = panelWindow.layout ?? useMainLayoutStore;
  const document = panelWindow.document ?? globalThis.document;
  const window = document.defaultView ?? globalThis.window;
  const sourceWindow = panelWindow.label ?? 'main';
  const enterGroup = panelWindow.enterGroup ?? useGroupStore.getState().enterGroup;
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => installPanelMaximizeShortcut(window, useLayoutStore, () =>
    !containerRef.current || !!containerRef.current.closest('[inert], [aria-hidden="true"]') ||
    !!document.querySelector('.mosaic-tile-dragging, .mosaic-gutter-dragging')
  ), [window, document, useLayoutStore]);
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
  const lockedIds = usePanelLockStore(s => s.lockedIds);
  // A sleeping panel has no live input to protect; its Wake button should work
  // on the first click even when it occupies an unfocused small slot.
  const sleepingKey = useInstanceStore(s => [...s.instances.values()].filter(i => i.hibernation?.sleeping).map(i => i.id).join(','));
  const sleepingIds = useMemo(() => new Set(sleepingKey.split(',')), [sleepingKey]);

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
    commit: () => void;
    pointerId: number;
    captureTarget: HTMLElement;
    previousCursor: string;
    previousUserSelect: string;
  } | null>(null);

  // Panel bodies use final pixel dimensions while their outer tiles animate.
  // Observe in the container's own window: an observer created in Main does
  // not receive resize deliveries for an element in a detached document.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const view = el.ownerDocument.defaultView ?? globalThis.window;

    const updateSize = () => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    };
    updateSize();

    const observer = new view.ResizeObserver(updateSize);
    observer.observe(el);
    view.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      view.removeEventListener('resize', updateSize);
    };
  }, []);

  // ─── Group enter/exit panel animation ──────────────────────────────
  const transitionDirection = useGroupStore((s) => sourceWindow === 'main' ? s.transitionDirection : null);
  const transitionGroupId = useGroupStore((s) => sourceWindow === 'main' ? s.transitionGroupId : null);
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
    window.requestAnimationFrame(() => {
      if (cancelled) return;
      window.requestAnimationFrame(() => {
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
  const nativeTarget = useWindowDragStore(s => s.drag?.targetLabel);
  // Keep the real panels stationary until release. Preview and commit share
  // the same geometry, including focus sizes and the actual panel count.
  const displayRects = panelRects;
  const snapPreview = useMemo(() => {
    const id = sidebarDragging ? '__sidebar-preview__' : draggingId;
    const zone = sidebarDragging ? sidebarDragSnap : activeSnap;
    if (!id || !zone || (!sidebarDragging && nativeTarget !== undefined && nativeTarget !== sourceWindow)) return null;
    const order = sidebarDragging ? [...tabOrder, id] : tabOrder;
    return { id, ...computeSnapLayout(order, id, zone, layoutConfig, stealFraction, sidebarSlotFractions, panelRects, lockedIds) };
  }, [sidebarDragging, sidebarDragSnap, draggingId, activeSnap, nativeTarget, tabOrder, layoutConfig, stealFraction, sidebarSlotFractions, sourceWindow, panelRects, lockedIds]);
  const previewPassthrough = useMemo(() => new Set(snapPreview ? [...lockedIds].filter(id =>
    id !== snapPreview.id && samePanelRect(panelRects.get(id), snapPreview.panelRects.get(id))) : []), [snapPreview, panelRects, lockedIds]);

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
    if (gutterDragging && resizeRef.current) {
      // Keep the captured gutter mounted with the same membership/key even
      // while other edges align with it, until the gesture is released.
      const { gutter } = resizeRef.current;
      const before = displayRects.get(gutter.panelsBefore[0]);
      return before ? [{ ...gutter, position: gutter.axis === 'x' ? before.x + before.w : before.y + before.h }] : [];
    }
    return computeGutters(displayRects);
  }, [displayRects, draggingId, isAnimating, maximizedId, gutterDragging]);

  // Gutter resize start
  const handleGutterDown = useCallback((e: React.PointerEvent, gutter: Gutter) => {
    if (e.button !== 0 || resizeRef.current || !containerRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    // Capture on the retained handle, so click/double-click still target the
    // divider itself. Capturing on its parent swallows double-click reset.
    const captureTarget = e.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(e.pointerId);
    captureTarget.focus({ preventScroll: true });
    const currentRects = useLayoutStore.getState().panelRects;
    resizeRef.current = {
      gutter,
      startPos: gutter.axis === 'x' ? e.clientX : e.clientY,
      startRects: new Map(currentRects),
      commit: beginPanelResize(useLayoutStore),
      pointerId: e.pointerId,
      captureTarget,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    setGutterDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = gutter.axis === 'x' ? 'col-resize' : 'row-resize';
  }, [useLayoutStore, document]);

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

    // Headers must get a chance to drag before a group click enters it.
    const toolbar = target.closest('.terminal-toolbar');
    if (toolbar) {
      e.preventDefault();
      target.setPointerCapture(e.pointerId);
      dragState.current = {
        panelId, startX: e.clientX, startY: e.clientY,
        started: false, currentSnap: null, returnToSidebar: false,
      };
      return;
    }

    // Clicking a group body enters it.
    const currentPanelType = useLayoutStore.getState().panelTypes[panelId];
    if (currentPanelType === 'group') {
      enterGroup(panelId);
      return;
    }

    // If clicking the unfocused overlay, just focus the panel
    if (target.classList.contains('unfocused-overlay')) {
      startResizeLock();
      setFocused(panelId);
      return;
    }

    // Only a focus change animates the layout. Locking an already focused
    // panel on pointer-down swallows mouse-up, including terminal link clicks
    // and selection gestures.
    if (useLayoutStore.getState().focusedId !== panelId) {
      startResizeLock();
      setFocused(panelId);
    }
  }, [setFocused, startResizeLock, useLayoutStore, enterGroup]);

  // Global pointer listeners for drag and resize
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Gutter resize
      const rs = resizeRef.current;
      if (rs) {
        if (e.pointerId !== rs.pointerId) return;
        if (!(e.buttons & 1)) { void onUp(e); return; }
        const c = containerRef.current;
        if (!c) return;
        const b = c.getBoundingClientRect();
        const containerDim = rs.gutter.axis === 'x' ? b.width : b.height;
        const mousePos = rs.gutter.axis === 'x' ? e.clientX : e.clientY;
        const deltaPx = mousePos - rs.startPos;
        setRawPanelRectsRef.current(resizePanels(rs.startRects, rs.gutter, (deltaPx / containerDim) * 100));
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
          document.body.style.cursor = 'default';
          beginWindowPanelDrag(ds.panelId, sourceWindow, e, 'panel');
        }

        // Detect drag-to-sidebar for widget panels
        const panelType = useLayoutStore.getState().panelTypes[ds.panelId];
        const isWidget = panelType === 'widget';
        if (sourceWindow === 'main' && isWidget && e.clientX >= 0 && e.clientX < 50 && e.clientY >= 0 && e.clientY <= window.innerHeight) {
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

    const releaseResize = () => {
      const rs = resizeRef.current;
      resizeRef.current = null;
      if (!rs) return;
      if (rs.captureTarget.hasPointerCapture(rs.pointerId)) rs.captureTarget.releasePointerCapture(rs.pointerId);
      document.body.style.userSelect = rs.previousUserSelect;
      document.body.style.cursor = rs.previousCursor;
      setGutterDragging(false);
      return rs;
    };
    const onUp = async (event: PointerEvent) => {
      // Gutter resize end
      if (resizeRef.current) {
        if (event.pointerId !== resizeRef.current.pointerId) return;
        const { gutter, commit } = releaseResize()!;
        window.getSelection()?.removeAllRanges();
        finishResizeRef.current(gutter.axis, gutter.panelsBefore, gutter.panelsAfter);
        commit();
        return;
      }

      // Panel drag end
      const ds = dragState.current;
      if (ds) {
        dragState.current = null;
        if (ds.started) {
          const moved = await finishWindowTabDrag(ds.panelId, sourceWindow);
          endWindowPanelDrag();
          if (moved) {
            setDraggingId(null); setActiveSnap(null);
            useLayoutStore.getState().setDragReturnToSidebar(false);
            document.body.style.userSelect = ''; document.body.style.cursor = '';
            return;
          }
        }
        if (ds.started && ds.returnToSidebar) {
          // Widget panel dragged back to sidebar - remove it
          startResizeLock();
          useLayoutStore.getState().removePanel(ds.panelId);
          useLayoutStore.getState().setDragReturnToSidebar(false);
        } else if (ds.started && ds.currentSnap) {
          startResizeLock();
          applySnapRef.current(ds.panelId, ds.currentSnap);
        } else if (!ds.started) {
          if (useLayoutStore.getState().panelTypes[ds.panelId] === 'group') {
            enterGroup(ds.panelId);
            return;
          }
          // An already focused panel does not resize. Locking it here swallowed
          // the second click on its title, preventing double-click rename.
          if (useLayoutStore.getState().focusedId !== ds.panelId) {
            startResizeLock();
            setFocusedRef.current(ds.panelId);
          }
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

    const cancel = () => {
      const rs = releaseResize();
      if (rs) {
        const current = useLayoutStore.getState().panelRects;
        if (current.size === rs.startRects.size && [...current.keys()].every(id => rs.startRects.has(id))) {
          setRawPanelRectsRef.current(rs.startRects);
        }
      }
      dragState.current = null;
      setGutterDragging(false); setDraggingId(null); setActiveSnap(null);
      useLayoutStore.getState().setDragReturnToSidebar(false);
      endWindowPanelDrag();
      if (!rs) { document.body.style.userSelect = ''; document.body.style.cursor = ''; }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && (dragState.current || resizeRef.current)) { e.preventDefault(); cancel(); } };
    const onLostCapture = (e: PointerEvent) => { if (resizeRef.current?.pointerId === e.pointerId) cancel(); };
    const onBlur = () => { if (resizeRef.current) cancel(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('lostpointercapture', onLostCapture);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('lostpointercapture', onLostCapture);
      window.removeEventListener('blur', onBlur);
      if (resizeRef.current) cancel();
    };
  }, [startResizeLock, useLayoutStore, window, document, sourceWindow, enterGroup]);

  // Keep the same measured root while empty: autosave restoration happens
  // after mount, and the container observer is registered only once.
  if (tabOrder.length === 0) {
    return (
      <div ref={containerRef} className="mosaic-container">
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
      className={'mosaic-container' + (gutterDragging ? ' mosaic-gutter-dragging' : '') + (draggingId ? ' mosaic-panel-dragging' : '')}
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
            data-panel-locked={lockedIds.has(id) ? '' : undefined}
            data-panel-resizing={gutterDragging && !samePanelRect(resizeRef.current?.startRects.get(id), rect) ? '' : undefined}
            data-panel-preview-moving={snapPreview && !samePanelRect(panelRects.get(id), snapPreview.panelRects.get(id)) ? '' : undefined}
            tabIndex={-1}
            className={
              'mosaic-tile'
              + (isDrag ? ' mosaic-tile-dragging' : '')
              + (resizing && !lockedIds.has(id) ? ' mosaic-tile-resizing' : '')
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
                : lockedIds.has(id) ? 11 : isFocused ? 10 : 1,
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
            {/* "Reveal" resize style: content is laid out at its FINAL size
                immediately, pinned top-left; the animating tile edge sweeps
                across it like a curtain. No mid-animation rewrap, and xterm
                refits exactly once at the start instead of after the tween. */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: containerSize.width > 0
                  ? Math.max(0, (containerSize.width * rect.w) / 100 - GAP * 2 - 2)
                  : '100%',
                height: containerSize.height > 0
                  ? Math.max(0, (containerSize.height * rect.h) / 100 - GAP * 2 - 2)
                  : '100%',
              }}
            >
            <PanelAppearance panelId={id}>
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
              : panelType === 'remote'
              ? <RemotePanel instanceId={id} />
              : <TerminalPanel instanceId={id} />
            }
            </PanelAppearance>
            </div>
            {/* Unfocused panel overlay: blocks xterm interactions until clicked */}
            {!isFocused && !isDrag && !sleepingIds.has(id) && tabOrder.length > 1 && (
              <div className="unfocused-overlay" />
            )}
          </div>
        );
      })}

      {/* Gutter resize handles at panel borders */}
      {gutters.map((g) => {
        const isV = g.axis === 'x';
        return (
          <div
            key={`${g.axis}:${g.panelsBefore.slice().sort().join(',')}:${g.panelsAfter.slice().sort().join(',')}`}
            className={`mosaic-gutter mosaic-gutter-${g.axis}`}
            tabIndex={-1}
            style={isV ? {
              position: 'absolute',
              zIndex: 30,
              left: `calc(${g.position}% - 4px)`,
              top: `calc(${g.start}% + ${GAP}px)`,
              width: 8,
              height: `calc(${g.end - g.start}% - ${GAP * 2}px)`,
              cursor: 'col-resize',
            } : {
              position: 'absolute',
              zIndex: 30,
              top: `calc(${g.position}% - 4px)`,
              left: `calc(${g.start}% + ${GAP}px)`,
              width: `calc(${g.end - g.start}% - ${GAP * 2}px)`,
              height: 8,
              cursor: 'row-resize',
            }}
            onPointerDown={(e) => handleGutterDown(e, g)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const commit = beginPanelResize(useLayoutStore);
              resetStealFraction();
              commit();
            }}
          />
        );
      })}

      {/* Snap zone highlight during tab drag or sidebar drag */}
      {snapPreview && containerSize.width > 0 && (
        <SnapZoneOverlay rects={snapPreview.panelRects} targetId={snapPreview.id} passthroughIds={previewPassthrough} />
      )}
    </div>
  );
}
