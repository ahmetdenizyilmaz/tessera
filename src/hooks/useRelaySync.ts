import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useAuthStore } from '../store/authStore';

export function useRelaySync() {
  useEffect(() => {
    const { isAuthenticated, offlineMode } = useAuthStore.getState();
    if (!isAuthenticated || offlineMode) return;

    // Subscribe to instance changes and sync to relay
    const unsub = useInstanceStore.subscribe((state) => {
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
    });

    return () => {
      unsub();
    };
  }, []);
}
