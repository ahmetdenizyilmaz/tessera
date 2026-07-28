import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useSystemStore } from '../store/systemStore';
import { useSettingsStore } from '../store/settingsStore';
import type { SystemUpdatePayload } from '../types/ipc';

// Serialize start/stop invokes so a stop from a previous effect cleanup can
// never land after (and kill) the monitor started by the next effect run
let monitorControl: Promise<unknown> = Promise.resolve();

export function useSystemMonitor() {
  // Reactive: restart the backend monitor whenever the interval setting changes
  const interval = useSettingsStore((s) => s.settings.systemMonitorInterval);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isMounted = true;

    // Start the system monitor on the backend
    monitorControl = monitorControl
      .then(() => invoke('system_monitor_start', { intervalMs: interval }))
      .catch((err) => {
        console.error('Failed to start system monitor:', err);
      });

    // Listen for system-update events
    (async () => {
      const fn = await listen<SystemUpdatePayload>('system-update', (event) => {
        if (!isMounted) return;
        useSystemStore.getState().setSystemInfo(event.payload);
      });
      if (!isMounted) {
        fn();
        return;
      }
      unlisten = fn;
    })();

    return () => {
      isMounted = false;
      if (unlisten) unlisten();
      monitorControl = monitorControl
        .then(() => invoke('system_monitor_stop'))
        .catch(() => {});
    };
  }, [interval]);
}
