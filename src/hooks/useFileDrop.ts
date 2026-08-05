import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useLayoutStore } from '../store/layoutStore';
import { insertIntoDraft } from '../components/chat/ChatInput';
import { isPtySpawned } from './usePty';

/** Wrap paths containing spaces so shells and the CLI treat them as one arg */
function quoteIfNeeded(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * Dropping OS files onto a panel inserts their full paths — the same thing
 * dragging a file into Claude Code's terminal does.
 *
 * The webview's HTML5 drop event cannot see real filesystem paths (browsers
 * withhold them), so this uses Tauri's native drag-drop event, which carries
 * `paths`, and routes by hit-testing the drop position against the mosaic
 * tile under the cursor.
 */
/** Hit-test a drag position (physical px) against the mosaic tiles */
function panelAt(position: { x: number; y: number }): string | null {
  const ratio = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / ratio, position.y / ratio);
  const panel = el?.closest('[data-panel-id]') as HTMLElement | null;
  return panel?.dataset.panelId ?? null;
}

export function useFileDrop(): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        // Dragging over a panel focuses it, so the drop target is obvious
        // before releasing — same feedback as clicking it.
        if (event.payload.type === 'over') {
          const hoverId = panelAt(event.payload.position);
          if (hoverId && useLayoutStore.getState().focusedId !== hoverId) {
            useLayoutStore.getState().setActiveTab(hoverId);
            useLayoutStore.getState().setFocused(hoverId);
          }
          return;
        }
        if (event.payload.type !== 'drop') return;
        const { paths, position } = event.payload;
        if (!paths || paths.length === 0) return;

        const panelId = panelAt(position)
          ?? useLayoutStore.getState().focusedId
          ?? useLayoutStore.getState().activeTabId;
        if (!panelId) return;

        // Make sure the dropped-on panel is the active one
        if (useLayoutStore.getState().focusedId !== panelId) {
          useLayoutStore.getState().setActiveTab(panelId);
          useLayoutStore.getState().setFocused(panelId);
        }

        const panelType = useLayoutStore.getState().panelTypes[panelId];
        if (panelType && panelType !== 'terminal') return;

        const text = paths.map(quoteIfNeeded).join(' ');

        // Terminal panels: type the paths straight into the PTY.
        // Chat panels: put them in the composer so the user can add context.
        if (isPtySpawned(panelId)) {
          invoke('pty_write', { id: panelId, data: text }).catch((err) =>
            console.error('Failed to write dropped paths to PTY:', err),
          );
        } else {
          insertIntoDraft(panelId, text);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error('Failed to register drag-drop listener:', err));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
