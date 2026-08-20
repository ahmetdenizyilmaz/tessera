/**
 * Frontend half of the `cgui` CLI launcher.
 *
 * Rust queues a directory on first launch (its own argv) and on every
 * forwarded `cgui` invocation (single-instance). This drains that queue and
 * opens a new tab per directory, using the same defaults as a quick-created
 * panel. `window.__drainLaunchDirs` is eval'd by Rust when a second instance
 * forwards; we also drain once on startup for the first-launch directory.
 */
import { invoke } from '@tauri-apps/api/core';
import { openSession } from './openSession';
import { useSettingsStore } from '../store/settingsStore';

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
      const panelView = useSettingsStore.getState().settings.lastPanelView || 'chat';
      // openSession applies default model/permission, registers the panel, and
      // respects the panel limit (toasting if full).
      openSession({ cwd: dir, panelView });
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
