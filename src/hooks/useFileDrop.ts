import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { readDir } from '@tauri-apps/plugin-fs';
import { useLayoutStore } from '../store/layoutStore';
import { insertIntoDraft } from '../components/chat/ChatInput';
import { isPtySpawned } from './usePty';

/** A folder drop means "work here"; a file drop means "here's a path" */
async function isDirectory(path: string): Promise<boolean> {
  try {
    await readDir(path);
    return true;
  } catch {
    return false;
  }
}

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
function panelAt(position: { x: number; y: number }): HTMLElement | null {
  const ratio = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / ratio, position.y / ratio);
  return el?.closest<HTMLElement>('.mosaic-tile[data-panel-id]') ?? null;
}

export function useFileDrop(onFolderDropped?: (path: string) => void): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    let highlighted: HTMLElement | null = null;

    function highlight(panel: HTMLElement | null) {
      const id = panel?.dataset.panelId;
      const layout = useLayoutStore.getState();
      if (!id || !layout.tabOrder.includes(id) || (layout.panelTypes[id] ?? 'terminal') !== 'terminal') panel = null;
      if (highlighted === panel) return;
      highlighted?.removeAttribute('data-file-drop-target');
      highlighted = panel;
      highlighted?.setAttribute('data-file-drop-target', '');
    }

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        // Focus rotates the mosaic. Preview the target without moving it
        // under the pointer; only select it after the file is released.
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          highlight(panelAt(event.payload.position));
          return;
        }
        highlight(null);
        if (event.payload.type !== 'drop') return;
        const { paths, position } = event.payload;
        if (!paths || paths.length === 0) return;
        // Capture before the asynchronous folder check: focus/layout can
        // change while it runs, but the drop must keep its original target.
        const panelId = panelAt(position)?.dataset.panelId ?? null;

        // A single folder means "open this project" — offer to attach one of
        // its sessions (or start fresh) rather than pasting a path.
        if (paths.length === 1 && onFolderDropped) {
          void isDirectory(paths[0]).then((dir) => {
            if (cancelled) return;
            if (dir) onFolderDropped(paths[0]);
            else handlePathDrop(paths, panelId);
          });
          return;
        }
        handlePathDrop(paths, panelId);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error('Failed to register drag-drop listener:', err));

    function handlePathDrop(paths: string[], panelId: string | null) {
        const layout = useLayoutStore.getState();
        // A closed/hidden panel or a drop outside a terminal must not send
        // paths to whichever unrelated panel happens to have focus now.
        if (!panelId || !layout.tabOrder.includes(panelId)) return;
        if ((layout.panelTypes[panelId] ?? 'terminal') !== 'terminal') return;

        // Make sure the dropped-on panel is the active one
        if (layout.focusedId !== panelId) {
          layout.setActiveTab(panelId);
          layout.setFocused(panelId);
        }

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
    }

    return () => {
      cancelled = true;
      highlight(null);
      unlisten?.();
    };
  }, [onFolderDropped]);
}
