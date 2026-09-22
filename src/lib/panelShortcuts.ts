import { captureGroupSnapshot, useGroupStore } from '../store/groupStore';
import { useLayoutStore } from '../store/layoutStore';
import { isShortcutNumber, usePanelShortcutStore } from '../store/panelShortcutStore';
import { notify } from './toast';

/** Navigation path to an open panel; orphaned/closed instances are not targets. */
export function panelGroupPath(panelId: string): string[] | null {
  const { groups, rootLayout } = captureGroupSnapshot();
  const visited = new Set<string>();
  const visit = (ids: string[], path: string[]): string[] | null => {
    if (ids.includes(panelId)) return path;
    for (const id of ids) {
      const group = groups.get(id);
      if (!group || visited.has(id)) continue;
      visited.add(id);
      const found = visit(group.childIds, [...path, id]);
      if (found) return found;
    }
    return null;
  };
  return visit(rootLayout?.tabOrder ?? useLayoutStore.getState().tabOrder, []);
}

/** Select an assigned panel without changing its conversation or terminal. */
export function focusShortcutPanel(panelId: string): boolean {
  const path = panelGroupPath(panelId);
  if (!path) return false;
  const current = useGroupStore.getState().groupStack;
  let shared = 0;
  while (shared < current.length && shared < path.length && current[shared] === path[shared]) shared++;
  if (shared !== current.length || shared !== path.length) {
    // Commit live ancestor layouts before jumping across navigation branches.
    useGroupStore.setState({ groups: captureGroupSnapshot().groups });
    if (shared < current.length) useGroupStore.getState().jumpToLevel(shared ? current[shared - 1] : null);
    for (const groupId of path.slice(shared)) {
      useGroupStore.getState().enterGroup(groupId);
      useGroupStore.getState().commitEnterGroup();
    }
    useGroupStore.getState().clearTransition();
  }
  const layout = useLayoutStore.getState();
  layout.setActiveTab(panelId);
  layout.setFocused(panelId);
  return true;
}

export function shortcutNumber(event: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (isShortcutNumber(event.key)) return event.key;
  // Also works with localized number rows and the numeric keypad.
  return /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1] ?? null;
}

export function installPanelShortcuts(options: { isBlocked?: () => boolean; onFocus?: () => void } = {}) {
  let frame: number | null = null;
  let observer: MutationObserver | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const cancelFocus = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    observer?.disconnect(); observer = null;
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
  };
  const blocked = () => !!options.isBlocked?.() || !!document.querySelector('.dialog-overlay, [role="dialog"][aria-modal="true"]');
  const updateModifiers = (event: KeyboardEvent) => {
    const allowed = !event.getModifierState('AltGraph') && !event.metaKey && !blocked();
    usePanelShortcutStore.getState().setModifiers(allowed && event.ctrlKey, allowed && event.altKey);
  };
  const focusInput = (panelId: string) => {
    cancelFocus();
    let focusedTile = false;
    const focus = () => {
      frame = null;
      if (blocked() || useLayoutStore.getState().focusedId !== panelId) { cancelFocus(); return; }
      const tile = document.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(panelId)}"]`);
      const input = tile && [...tile.querySelectorAll<HTMLTextAreaElement>('textarea:not(:disabled)')]
        .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
        .sort((a, b) => Number(b.matches('.xterm-helper-textarea, .chat-textarea')) - Number(a.matches('.xterm-helper-textarea, .chat-textarea')))[0];
      if (input) { cancelFocus(); input.focus({ preventScroll: true }); return; }
      if (tile && !focusedTile) { tile.focus({ preventScroll: true }); focusedTile = true; }
    };
    // A group jump can mount an agent whose composer is temporarily disabled
    // while reconnecting. Focus when it becomes ready, unless the user moves on.
    observer = new MutationObserver(() => { if (frame === null) frame = requestAnimationFrame(focus); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['disabled', 'class', 'style'] });
    timeout = setTimeout(cancelFocus, 10000);
    frame = requestAnimationFrame(focus);
  };
  const keydown = (event: KeyboardEvent) => {
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) cancelFocus();
    updateModifiers(event);
    if (event.isComposing || event.metaKey || event.shiftKey || event.getModifierState('AltGraph') || blocked()) return;
    const number = shortcutNumber(event);
    if (number === null) return;
    if (event.altKey && !event.ctrlKey) {
      const layout = useLayoutStore.getState();
      const panelId = layout.focusedId ?? layout.activeTabId;
      if (!panelId || !layout.tabOrder.includes(panelId)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      usePanelShortcutStore.getState().assign(number, panelId);
      notify(`Panel shortcut assigned: Ctrl+${number}`);
    } else if (event.ctrlKey && !event.altKey) {
      const panelId = usePanelShortcutStore.getState().bindings[number];
      if (!panelId) return;
      // Capture before xterm or an input can turn the shortcut into terminal data.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (focusShortcutPanel(panelId)) {
        options.onFocus?.();
        focusInput(panelId);
      } else {
        usePanelShortcutStore.getState().removePanels([panelId]);
        notify(`That panel is closed. Assign Ctrl+${number} again with Alt+${number}.`);
      }
    }
  };
  const keyup = updateModifiers;
  const reset = () => { cancelFocus(); usePanelShortcutStore.getState().setModifiers(false, false); };
  const visibility = () => { if (document.hidden) reset(); };
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('keyup', keyup, true);
  window.addEventListener('blur', reset);
  window.addEventListener('pointerdown', cancelFocus, true);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('keyup', keyup, true);
    window.removeEventListener('blur', reset);
    window.removeEventListener('pointerdown', cancelFocus, true);
    document.removeEventListener('visibilitychange', visibility);
    reset();
  };
}
