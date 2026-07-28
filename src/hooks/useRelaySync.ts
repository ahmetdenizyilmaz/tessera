import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useAuthStore } from '../store/authStore';

const SYNC_DEBOUNCE_MS = 300;

export function useRelaySync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const offlineMode = useAuthStore((s) => s.offlineMode);

  useEffect(() => {
    if (!isAuthenticated || offlineMode) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    // Subscribe to instance changes and sync to relay (debounced — status
    // flips constantly during streaming and each sync is an IPC round-trip)
    const unsub = useInstanceStore.subscribe((state) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const instances = Array.from(state.instances.values()).map((inst) => ({
          id: inst.id,
          name: inst.name,
          color: inst.color,
          status: inst.status,
          config: inst.config,
        }));

        invoke('relay_send_instances', { instances }).catch((err) => {
          console.error('Failed to sync instances to relay:', err);
        });
      }, SYNC_DEBOUNCE_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [isAuthenticated, offlineMode]);
}
