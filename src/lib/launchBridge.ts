/**
 * Frontend half of the `cgui` CLI launcher.
 *
 * Rust queues a directory on first launch (its own argv) and on every
 * forwarded `cgui` invocation (single-instance). This drains that queue and
 * opens a new tab per directory. `window.__drainLaunchDirs` is eval'd by Rust
 * when a second instance forwards; we also drain once on startup for the
 * first-launch directory.
 */
import { invoke } from '@tauri-apps/api/core';
import { openSession } from './openSession';
import { useLayoutStore } from '../store/layoutStore';

declare global {
  interface Window {
    __drainLaunchDirs?: () => void;
  }
}

let draining = false;

async function drain() {
  if (draining) return; // guard against overlapping drains
  draining = true;
  try {
    const dirs = await invoke<string[]>('take_launch_dirs');
    for (const dir of dirs) {
      if (!dir) continue;
      // cgui is a terminal command, so open a terminal-mode panel. Model and
      // permission mode come from the user's defaults (Opus / auto) via
      // openSession. It activates + focuses the new panel already; we re-assert
      // focus after in case a group/maximize state was in play, so `cgui` always
      // lands you on the panel it just opened.
      const id = openSession({ cwd: dir, panelView: 'terminal' });
      if (id) {
        useLayoutStore.getState().setActiveTab(id);
        useLayoutStore.getState().setFocused(id);
      }
    }
  } catch (err) {
    console.error('[launchBridge] take_launch_dirs failed:', err);
  } finally {
    draining = false;
  }
}

export function initLaunchBridge() {
  window.__drainLaunchDirs = () => { void drain(); };
  // First-launch directory: drain once the stores are ready. A short delay lets
  // workspace restore settle so the new tab lands alongside the restored ones
  // rather than racing them.
  setTimeout(() => { void drain(); }, 1200);
}
