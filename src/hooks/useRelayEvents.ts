import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from '../store/authStore';

export function useRelayEvents() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const offlineMode = useAuthStore((s) => s.offlineMode);

  useEffect(() => {
    if (!isAuthenticated || offlineMode) return;

    let unlisten: (() => void) | null = null;
    let isMounted = true;

    (async () => {
      const fn = await listen<unknown>('relay-push', (event) => {
        if (!isMounted) return;
        // Handle relay push events (remote commands, instance sync, etc.)
        console.log('Relay push event:', event.payload);
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
    };
  }, [isAuthenticated, offlineMode]);
}
