import { invoke } from '@tauri-apps/api/core';
import { usePluginStore } from '../store/pluginStore';

// Native views survive React unmounts when navigating into/out of groups.
// Serialize operations per view, including StrictMode cleanup and recreation.
const queues = new Map<string, Promise<unknown>>();
export function browserCommand<T = void>(id: string, command: string, args: Record<string, unknown> = {}): Promise<T> {
  const task = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(() => invoke<T>(command, { id, ...args }));
  queues.set(id, task);
  void task.finally(() => { if (queues.get(id) === task) queues.delete(id); }).catch(() => {});
  return task;
}

usePluginStore.subscribe((state, previous) => {
  for (const [id, instance] of previous.instances) {
    if (!state.instances.has(id) && previous.registry.get(instance.pluginName)?.browserSite) {
      void browserCommand(id, 'browser_panel_close').catch(console.error);
    }
  }
});

export interface SurfaceBounds { x: number; y: number; width: number; height: number; scale: number }

/** Native child views draw above HTML. Hide them while host overlays are open,
 * and clip them to their panel's visible area during layout transitions. */
export function measureBrowserSurface(element: HTMLElement): SurfaceBounds | null {
  if (!element.isConnected || document.hidden) return null;
  if (document.querySelector('.mosaic-tile-dragging, .mosaic-gutter-dragging')) return null;
  for (const overlay of document.querySelectorAll<HTMLElement>('.dialog-overlay, .menu-dropdown, .context-menu, [data-browser-overlay], [role="dialog"]')) {
    if (overlay.getClientRects().length && getComputedStyle(overlay).visibility !== 'hidden') return null;
  }
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.inert || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
    if (node !== element && /(hidden|clip|auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY)) {
      const clip = node.getBoundingClientRect();
      left = Math.max(left, clip.left + node.clientLeft);
      top = Math.max(top, clip.top + node.clientTop);
      right = Math.min(right, clip.left + node.clientLeft + node.clientWidth);
      bottom = Math.min(bottom, clip.top + node.clientTop + node.clientHeight);
    }
  }
  if (right - left < 40 || bottom - top < 40) return null;
  // Catch other host popovers without requiring every existing component to
  // know about native browser panels. The ordinary focus overlay is exempt.
  for (const x of [left + 2, (left + right) / 2, right - 2]) {
    for (const y of [top + 2, (top + bottom) / 2, bottom - 2]) {
      const hit = document.elementsFromPoint(x, y).find(n => !n.classList.contains('unfocused-overlay'));
      if (hit && !element.contains(hit)) return null;
    }
  }
  return { x: Math.round(left), y: Math.round(top), width: Math.floor(right - left), height: Math.floor(bottom - top), scale: devicePixelRatio };
}
