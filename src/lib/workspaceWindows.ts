import { invoke } from '@tauri-apps/api/core';
import { Window as NativeWindow } from '@tauri-apps/api/window';
import { useWorkspaceWindowStore, type DetachedWorkspace } from '../store/workspaceWindowStore';
import { captureGroupSnapshot, getPanelLocations, removePanelsFromWorkspace, useGroupStore } from '../store/groupStore';
import { useLayoutStore } from '../store/layoutStore';
import { closePanel } from './panelCleanup';
import { notify } from './toast';

export const detachedViews = new Map<string, Window>();
const opening = new Map<string, Promise<Window>>();
const disposing = new Set<string>();
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
    if (name.startsWith('data-')) target.documentElement.setAttribute(name, value);
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
  if (exiting) return;
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
  }
}

export function movePanelToWindow(panelId: string, target: DetachedWorkspace | null) {
  const groupId = target?.groupId ?? useGroupStore.getState().getCurrentGroupId();
  useGroupStore.getState().movePanelToLevel(panelId, groupId);
  if (groupId) useGroupStore.getState().setGroupActiveChild(groupId, panelId);
}

/** Returns true when a drop was handled outside the source window. */
export async function finishWindowTabDrag(panelId: string, source = 'main'): Promise<boolean> {
  try {
    const target = await invoke<{ label: string | null; x: number; y: number }>('workspace_drop_target');
    if (target.label === source) return false;
    if (target.label === 'main') { movePanelToWindow(panelId, null); return true; }
    const workspace = useWorkspaceWindowStore.getState().windows.find(w => windowLabel(w.id) === target.label);
    if (workspace) { movePanelToWindow(panelId, workspace); return true; }
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
  detachedViews.get(owner.id)?.dispatchEvent(new CustomEvent('tessera-focus-panel', { detail: panelId }));
  void new NativeWindow(windowLabel(owner.id)).setFocus();
  return true;
}
