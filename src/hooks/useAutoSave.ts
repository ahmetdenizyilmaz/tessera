import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';
import { usePluginStore } from '../store/pluginStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSessionStore } from '../store/sessionStore';
import { restoreOnce, saveNow, scheduleSave } from '../lib/workspaceSerializer';

const AUTOSAVE_INTERVAL = 30000; // 30 seconds

export function useAutoSave() {
  // Reactive: toggling the setting takes effect without a reload
  const autoSave = useSettingsStore((s) => s.settings.autoSave);

  // Restore on mount (module-level guard in the serializer makes this safe
  // against double-mount / StrictMode / App remount)
  useEffect(() => {
    restoreOnce();
  }, []);

  // Persist active sessions AND the workspace on window close
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    // Registering this listener makes Tauri PREVENT the native close and wait
    // for JS to destroy the window. So the save work must never be able to
    // throw (or the window would stay open forever), and we destroy the
    // window ourselves rather than relying on the default path.
    getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        const instances = useInstanceStore.getState().instances;
        const sessionStore = useSessionStore.getState();
        // Every real panel — the tab strip AND panels inside groups (grouped
        // panels were being missed). Skip orphans, LLM/plugin panels (no
        // resumable session), and anything without a claudeSessionId (an
        // id-less row can't be reopened and was just accumulating junk on
        // every close).
        const real = new Set<string>(useLayoutStore.getState().tabOrder);
        for (const g of useGroupStore.getState().groups.values()) {
          for (const c of g.childIds) real.add(c);
        }
        instances.forEach((inst) => {
          if (!real.has(inst.id) || inst.config.llmConfig) return;
          if (!inst.claudeSessionId) return;
          sessionStore.addSession({
            instanceId: inst.id,
            name: inst.name,
            projectPath: inst.config.cwd,
            messageCount: 0,
            startedAt: Date.now(),
            endedAt: Date.now(),
            claudeSessionId: inst.claudeSessionId,
            panelView: inst.config.panelView === 'terminal' ? 'terminal' : 'chat',
          });
        });
        if (useSettingsStore.getState().settings.autoSave) {
          saveNow();
        }
      } catch (err) {
        console.error('Save on close failed:', err);
      }
      // Must not be swallowed: if destroy() is rejected (e.g. a missing
      // core:window:allow-destroy permission) the close stays prevented and
      // the window becomes impossible to close.
      try {
        await getCurrentWindow().destroy();
      } catch (err) {
        console.error('Window destroy failed — forcing exit:', err);
        const { exit } = await import('@tauri-apps/plugin-process');
        await exit(0);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Debounced save on every workspace mutation
  useEffect(() => {
    if (!autoSave) return;

    const unsubs = [
      useInstanceStore.subscribe(scheduleSave),
      useLayoutStore.subscribe(scheduleSave),
      useGroupStore.subscribe(scheduleSave),
      usePluginStore.subscribe(scheduleSave),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [autoSave]);

  // Auto-save on interval (safety net)
  useEffect(() => {
    if (!autoSave) return;

    const timer = setInterval(saveNow, AUTOSAVE_INTERVAL);
    return () => clearInterval(timer);
  }, [autoSave]);
}
