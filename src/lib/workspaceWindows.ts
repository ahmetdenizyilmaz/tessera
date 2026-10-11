import { invoke } from '@tauri-apps/api/core';
import { Window as NativeWindow } from '@tauri-apps/api/window';
import { useWorkspaceWindowStore, type DetachedWorkspace } from '../store/workspaceWindowStore';
import { captureGroupSnapshot, getPanelLocations, removePanelsFromWorkspace, useGroupStore } from '../store/groupStore';
import { useLayoutStore } from '../store/layoutStore';
import { closePanel } from './panelCleanup';
import { notify } from './toast';
import { outsideTabStrip, useWindowDragStore } from '../store/windowDragStore';

export const detachedViews = new Map<string, Window>();
const opening = new Map<string, Promise<Window>>();
const disposing = new Set<string>();
const detaching = new Set<string>();
const cleanupListeners = new Map<string, () => void>();
let exiting = false;
export const isExitingWindows = () => exiting;
export const windowLabel = (id: string) => `workspace-${id}`;

export function panelWorkspace(panelId: string): DetachedWorkspace | undefined {
  const { groups } = captureGroupSnapshot();
  let id: string | null | undefined = panelId;
  const locations = getPanelLocations(captureGroupSnapshot());
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    const found = useWorkspaceWindowStore.getState().windows.find(w => w.groupId === id);
    if (found) return found;
    seen.add(id);
    id = groups.get(id)?.parentId ?? locations.get(id);
  }
}

export function copyWindowStyles(target: Document) {
  target.querySelectorAll('[data-tessera-style]').forEach(node => node.remove());
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.dataset.tesseraStyle = '';
    target.head.appendChild(clone);
  }
  target.documentElement.className = document.documentElement.className;
  target.documentElement.style.cssText = document.documentElement.style.cssText;
  for (const { name, value } of [...document.documentElement.attributes]) {
    if (name.startsWith('data-') && !name.startsWith('data-window-') && !name.startsWith('data-workspace-')) target.documentElement.setAttribute(name, value);
  }
}

export function ensureDetachedView(workspace: DetachedWorkspace): Promise<Window> {
  const existing = detachedViews.get(workspace.id);
  if (existing && !existing.closed) return Promise.resolve(existing);
  const pending = opening.get(workspace.id);
  if (pending) return pending;
  const task = (async () => {
    if (exiting) throw new Error('Tessera is closing');
    const child = window.open(`/detached.html?id=${encodeURIComponent(workspace.id)}`, windowLabel(workspace.id), 'popup,width=1100,height=750');
    if (!child) throw new Error('The new window could not be opened. Your panel has stayed in its original window.');
    const started = Date.now();
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (child.closed || Date.now() - started > 12000) { reject(new Error('The new window did not finish opening')); return; }
        try { if (child.document.getElementById('detached-root')) { resolve(); return; } } catch { /* still navigating */ }
        setTimeout(check, 30);
      };
      check();
    });
    detachedViews.set(workspace.id, child);
    copyWindowStyles(child.document);
    child.document.documentElement.dataset.workspaceWindow = windowLabel(workspace.id);
    const native = new NativeWindow(windowLabel(workspace.id));
    const saveBounds = async () => {
      if (disposing.has(workspace.id) || exiting) return;
      if (await native.isMinimized() || await native.isMaximized()) return;
      const [pos, size] = await Promise.all([native.outerPosition(), native.innerSize()]);
      useWorkspaceWindowStore.getState().setBounds(workspace.id, { x: pos.x, y: pos.y, width: size.width, height: size.height });
    };
    const unlisteners = await Promise.all([
      native.onCloseRequested(e => { e.preventDefault(); void closeDetachedWorkspace(workspace.id); }),
      native.onMoved(() => { void saveBounds().catch(() => {}); }),
      native.onResized(() => { void saveBounds().catch(() => {}); }),
    ]);
    cleanupListeners.set(workspace.id, () => unlisteners.forEach(fn => fn()));
    const bounds = workspace.bounds ?? { x: Math.round(window.screenX * devicePixelRatio + 100), y: Math.round(window.screenY * devicePixelRatio + 100), width: Math.round(1000 * devicePixelRatio), height: Math.round(700 * devicePixelRatio) };
    await invoke('workspace_window_place', { label: windowLabel(workspace.id), bounds });
    return child;
  })();
  opening.set(workspace.id, task);
  void task.finally(() => opening.delete(workspace.id)).catch(() => {});
  return task;
}

async function destroyView(id: string) {
  cleanupListeners.get(id)?.();
  cleanupListeners.delete(id);
  detachedViews.delete(id);
  await invoke('workspace_window_destroy', { label: windowLabel(id) }).catch(error => console.error('Could not close detached window:', error));
}

export async function closeDetachedWorkspace(id: string, closeContents = true) {
  if (disposing.has(id) || exiting) return;
  disposing.add(id);
  try {
    const workspace = useWorkspaceWindowStore.getState().windows.find(w => w.id === id);
    if (workspace) {
      if (closeContents) await closePanel(workspace.groupId);
      else removePanelsFromWorkspace([workspace.groupId]);
    }
    useWorkspaceWindowStore.getState().remove(id);
    await destroyView(id);
  } finally { disposing.delete(id); }
}

export async function closeWindowViewsForExit() {
  exiting = true;
  await Promise.all([...detachedViews.keys()].map(destroyView));
}

export async function detachPanel(panelId: string, point?: { x: number; y: number }) {
  if (exiting || detaching.has(panelId)) return;
  detaching.add(panelId);
  const id = crypto.randomUUID();
  const workspace: DetachedWorkspace = { id, groupId: '', ...(point ? { bounds: { x: Math.round(point.x - 80), y: Math.round(point.y - 20), width: Math.round(1000 * devicePixelRatio), height: Math.round(700 * devicePixelRatio) } } : {}) };
  try {
    await ensureDetachedView(workspace);
    const groupId = useGroupStore.getState().createGroup(null, `Window ${useWorkspaceWindowStore.getState().windows.length + 1}`);
    workspace.groupId = groupId;
    useGroupStore.getState().movePanelToLevel(panelId, groupId);
    if (!useGroupStore.getState().groups.get(groupId)?.childIds.includes(panelId)) {
      removePanelsFromWorkspace([groupId]);
      await destroyView(id);
      return;
    }
    useWorkspaceWindowStore.getState().add(workspace);
  } catch (e) {
    await destroyView(id);
    notify(String(e));
  } finally { detaching.delete(panelId); }
}

export function movePanelToWindow(panelId: string, target: DetachedWorkspace | null, placement?: { groupId?: string; index?: number }) {
  const groupId = placement?.groupId ?? target?.groupId ?? useGroupStore.getState().getCurrentGroupId();
  useGroupStore.getState().movePanelToLevel(panelId, groupId);
  if (groupId) useGroupStore.getState().setGroupActiveChild(groupId, panelId);
  if (placement?.index !== undefined) {
    if (groupId === useGroupStore.getState().getCurrentGroupId()) {
      const layout = useLayoutStore.getState();
      const from = layout.tabOrder.indexOf(panelId);
      if (from >= 0) layout.moveTab(from, Math.min(placement.index, layout.tabOrder.length - 1));
    } else if (groupId) {
      const group = useGroupStore.getState().groups.get(groupId);
      if (group?.childIds.includes(panelId)) {
        const childIds = group.childIds.filter(id => id !== panelId);
        childIds.splice(placement.index, 0, panelId);
        useGroupStore.setState(s => ({ groups: new Map(s.groups).set(groupId, { ...group, childIds, layoutConfig: null, panelRects: new Map() }) }));
      }
    }
  }
}

interface DropTarget { label: string | null; x: number; y: number; clientX?: number; clientY?: number }
let stopDragTracking: (() => void) | undefined;
const dragDocuments = () => [document, ...[...detachedViews.values()].filter(w => !w.closed).map(w => w.document)];
const targetDocument = (label: string | null) => label === 'main' ? document : [...detachedViews.entries()].find(([id]) => windowLabel(id) === label)?.[1].document;

function pullsAwayFromTabs(doc: Document, x: number, y: number) {
  const strip = doc.querySelector('[data-window-tabstrip]');
  const breadcrumb = doc.querySelector('.group-breadcrumb')?.getBoundingClientRect();
  const onBreadcrumb = breadcrumb && x >= breadcrumb.left && x <= breadcrumb.right && y >= breadcrumb.top && y <= breadcrumb.bottom;
  return !!strip && !onBreadcrumb && outsideTabStrip(x, y, strip.getBoundingClientRect());
}

function insertionAt(doc: Document, x: number, y: number, panelId: string) {
  const strip = doc.querySelector<HTMLElement>('[data-window-tabstrip]');
  if (!strip) return;
  const bounds = strip.getBoundingClientRect();
  if (y < bounds.top || y > bounds.bottom || x < bounds.left || x > bounds.right) return;
  const tabs = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')].filter(t => t.dataset.tabId !== panelId);
  const found = tabs.findIndex(tab => x < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2);
  const index = found < 0 ? tabs.length : found;
  const left = tabs[index]?.getBoundingClientRect().left ?? tabs.at(-1)?.getBoundingClientRect().right ?? bounds.left + 6;
  return { index, left, top: bounds.top + 4, height: bounds.height - 8 };
}

function clearDropMarkers() {
  for (const doc of dragDocuments()) {
    doc.documentElement.removeAttribute('data-window-drop-target');
    doc.querySelector('[data-window-drop-marker]')?.remove();
  }
}

/** Keep one drag alive across embedded sites, native windows and tab strips. */
export function beginWindowPanelDrag(panelId: string, source: string, event: Event, kind: 'tab' | 'panel' = 'tab') {
  stopDragTracking?.();
  const pointer = event as PointerEvent;
  const node = event.target as Element | null;
  const doc = node?.ownerDocument ?? targetDocument(source) ?? document;
  const view = doc.defaultView!;
  useWindowDragStore.setState({ drag: { panelId, source, kind, x: pointer.clientX, y: pointer.clientY, tearOff: false, targetLabel: source, hint: null } });
  setWindowTabDragging(true);
  let disposed = false, busy = false;
  const move = (e: PointerEvent) => {
    const state = useWindowDragStore.getState().drag;
    if (!state) return;
    const tearOff = kind === 'tab' && pullsAwayFromTabs(doc, e.clientX, e.clientY);
    useWindowDragStore.setState({ drag: { ...state, x: e.clientX, y: e.clientY, tearOff,
      hint: state.targetLabel && state.targetLabel !== source ? 'Move to this window' : tearOff || state.targetLabel === null ? 'Release to open a new window' : null } });
  };
  const poll = async () => {
    if (busy || disposed) return;
    busy = true;
    try {
      const target = await invoke<DropTarget>('workspace_drop_target');
      if (disposed || !target) return;
      const state = useWindowDragStore.getState().drag;
      if (!state) return;
      clearDropMarkers();
      const other = target.label && target.label !== source;
      useWindowDragStore.setState({ drag: { ...state, targetLabel: target.label,
        hint: other ? 'Move to this window' : target.label === null || state.tearOff ? 'Release to open a new window' : null } });
      if (other) {
        const destination = targetDocument(target.label);
        if (destination) {
          destination.documentElement.setAttribute('data-window-drop-target', '');
          const insert = insertionAt(destination, target.clientX ?? -1, target.clientY ?? -1, panelId);
          if (insert) {
            const marker = destination.createElement('div');
            marker.dataset.windowDropMarker = '';
            marker.style.cssText = `position:fixed;pointer-events:none;z-index:10000;left:${insert.left}px;top:${insert.top}px;width:3px;height:${insert.height}px;background:var(--accent)`;
            destination.body.appendChild(marker);
          }
        }
      }
    } catch { /* Native targeting is unavailable in a regular browser. */ }
    finally { busy = false; }
  };
  doc.addEventListener('pointermove', move, true);
  const timer = view.setInterval(() => void poll(), 50);
  void poll();
  stopDragTracking = () => { disposed = true; view.clearInterval(timer); doc.removeEventListener('pointermove', move, true); clearDropMarkers(); };
}

export function endWindowPanelDrag() {
  stopDragTracking?.(); stopDragTracking = undefined;
  useWindowDragStore.setState({ drag: null });
  setWindowTabDragging(false);
}

/** Returns true when a drop was handled outside the source window. */
export async function finishWindowTabDrag(panelId: string, source = 'main'): Promise<boolean> {
  try {
    const drag = useWindowDragStore.getState().drag;
    stopDragTracking?.(); stopDragTracking = undefined;
    const target = await invoke<DropTarget>('workspace_drop_target');
    if (!target) return false;
    const sourceDoc = targetDocument(source);
    const tearOff = drag?.panelId === panelId && drag.kind === 'tab' && (target.clientX !== undefined && target.clientY !== undefined && sourceDoc
      ? pullsAwayFromTabs(sourceDoc, target.clientX, target.clientY) : drag.tearOff);
    if (target.label === source && !tearOff) return false;
    if (target.label === source) { await detachPanel(panelId, target); return true; }
    const doc = targetDocument(target.label);
    const insert = doc && insertionAt(doc, target.clientX ?? -1, target.clientY ?? -1, panelId);
    const placement = { groupId: doc?.documentElement.dataset.workspaceGroup, index: insert?.index };
    if (target.label === 'main') { movePanelToWindow(panelId, null, placement); void new NativeWindow('main').setFocus(); return true; }
    const workspace = useWorkspaceWindowStore.getState().windows.find(w => windowLabel(w.id) === target.label);
    if (workspace) { movePanelToWindow(panelId, workspace, placement); void new NativeWindow(windowLabel(workspace.id)).setFocus(); return true; }
    await detachPanel(panelId, target);
    return true;
  } catch { return false; } // ordinary browser fixtures / unavailable native drag
}

export function setWindowTabDragging(dragging: boolean) {
  for (const doc of [document, ...[...detachedViews.values()].filter(w => !w.closed).map(w => w.document)]) {
    doc.documentElement.toggleAttribute('data-tab-dragging', dragging);
  }
}

export function focusDetachedPanel(panelId: string): boolean {
  const owner = panelWorkspace(panelId);
  if (!owner) return false;
  const groups = useGroupStore.getState();
  // Select the outer tab containing a nested panel. The window handles its
  // local group navigation independently of Main's group stack.
  const locations = getPanelLocations(captureGroupSnapshot());
  let top = panelId;
  const seen = new Set<string>();
  while (locations.get(top) && locations.get(top) !== owner.groupId && !seen.has(top)) { seen.add(top); top = locations.get(top)!; }
  groups.setGroupActiveChild(owner.groupId, top);
  const child = detachedViews.get(owner.id);
  child?.dispatchEvent(new CustomEvent('tessera-focus-panel', { detail: panelId }));
  // Undo can restore the workspace record before its native window is open.
  // Opening the view will focus it; only address existing native windows here.
  if (child && !child.closed) void new NativeWindow(windowLabel(owner.id)).setFocus().catch(() => {});
  return true;
}
