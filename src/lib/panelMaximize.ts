import type { LayoutStore } from '../store/layoutStore';

export const PANEL_MAXIMIZE_EVENT = 'tessera:maximize-panel';

/** One handler per workspace window. Capture before editors/xterm consume F11. */
export function installPanelMaximizeShortcut(view: Window, layout: LayoutStore, isBlocked: () => boolean = () => false) {
  const toggle = (panelId?: string) => {
    if (isBlocked() || view.document.querySelector('.dialog-overlay, .splash-screen, [role="dialog"][aria-modal="true"]')) return;
    const state = layout.getState();
    const id = panelId ?? state.maximizedId ?? state.focusedId ?? state.activeTabId;
    if (!id || !state.tabOrder.includes(id)) return;
    state.toggleMaximized(id);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'F11' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) toggle();
  };
  const maximize = (event: Event) => {
    const id = (event as CustomEvent<unknown>).detail;
    if (typeof id === 'string') toggle(id);
  };
  // Plugin iframe keys do not bubble. Accept only this window's own panel
  // frames, deriving the panel ID from the frame rather than message data.
  const message = (event: MessageEvent) => {
    if (event.data?.type !== PANEL_MAXIMIZE_EVENT) return;
    const frame = [...view.document.querySelectorAll('iframe')].find(frame => frame.contentWindow === event.source);
    const id = frame?.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId;
    if (id) toggle(id);
  };
  view.addEventListener('keydown', keydown, true);
  view.addEventListener(PANEL_MAXIMIZE_EVENT, maximize);
  view.addEventListener('message', message);
  return () => {
    view.removeEventListener('keydown', keydown, true);
    view.removeEventListener(PANEL_MAXIMIZE_EVENT, maximize);
    view.removeEventListener('message', message);
  };
}
