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

    getCurrentWindow().onCloseRequested(() => {
      const instances = useInstanceStore.getState().instances;
      const sessionStore = useSessionStore.getState();
      instances.forEach((inst) => {
        sessionStore.addSession({
          instanceId: inst.id,
          name: inst.name,
          projectPath: inst.config.cwd,
          messageCount: 0,
          startedAt: Date.now(),
          endedAt: Date.now(),
        });
      });
      if (useSettingsStore.getState().settings.autoSave) {
        saveNow();
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
