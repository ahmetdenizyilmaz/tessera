import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useSystemStore } from '../store/systemStore';
import { useSettingsStore } from '../store/settingsStore';
import type { SystemUpdatePayload } from '../types/ipc';

export function useSystemMonitor() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isMounted = true;

    const interval = useSettingsStore.getState().settings.systemMonitorInterval;

    // Start the system monitor on the backend
    invoke('system_monitor_start').catch((err) => {
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
      invoke('system_monitor_stop').catch(() => {});
    };
  }, []);
}
