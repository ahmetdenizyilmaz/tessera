import { useWorkspaceHistoryStore } from '../store/workspaceHistoryStore';

export function installWorkspaceHistoryShortcuts(view: Window, isBlocked: () => boolean = () => false) {
  let panelControls = false;
  const pointerdown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    panelControls = !!target?.closest?.('.tab-item, .detached-tabs, .terminal-toolbar, .browser-toolbar, .mosaic-gutter, .menu-bar, .panel-context-menu');
    if (target?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])')) panelControls = false;
  };
  const blur = () => { panelControls = false; };
  const keydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (!['control', 'meta', 'shift', 'alt'].includes(key) &&
      !((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y'))) panelControls = false;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing || event.defaultPrevented) return;
    if (key !== 'z' && key !== 'y') return;
    const target = event.target as HTMLElement | null;
    // Closing a panel auto-focuses its neighbour's composer. Keep undo aimed
    // at panel controls until the user clicks into an editor or types again.
    if (!panelControls && target?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
    if (isBlocked() || view.document.querySelector('.dialog-overlay, [role="dialog"][aria-modal="true"]')) return;
    const history = useWorkspaceHistoryStore.getState();
    if (!(key === 'z' ? history.past : history.future).length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) void (key === 'z' ? history.undo() : history.redo());
  };
  view.addEventListener('keydown', keydown, true);
  view.addEventListener('pointerdown', pointerdown, true);
  view.addEventListener('blur', blur);
  return () => {
    view.removeEventListener('keydown', keydown, true);
    view.removeEventListener('pointerdown', pointerdown, true);
    view.removeEventListener('blur', blur);
  };
}
