import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuthStore } from '../store/authStore';
import { useRelaySync } from '../hooks/useRelaySync';
import { useRelayEvents } from '../hooks/useRelayEvents';
import { ErrorBoundary } from '../components/ErrorBoundary';

interface AuthGateProps {
  children: React.ReactNode;
}

// Relay hooks are always mounted and no-op internally while unauthenticated —
// keeping the element tree shape stable so <App> never unmounts/remounts on an
// auth transition (a remount would duplicate restored instances and destroy
// every terminal).
const OnlineApp: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useRelaySync();
  useRelayEvents();
  return <>{children}</>;
};

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [checking, setChecking] = useState(true);
  const { setAuth, goOffline } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      try {
        const user = await invoke<{ id: string; email: string; name?: string } | null>('auth_check');
        if (!mounted) return;

        if (user) {
          // Both hit the (slow on Windows) OS keyring — run them in parallel
          const [token, serverUrl] = await Promise.all([
            invoke<string | null>('get_access_token'),
            invoke<string | null>('get_server_url'),
          ]);

          if (token && serverUrl) {
            setAuth(user, token, serverUrl);
          } else {
            // User exists but no token - go offline
            goOffline();
          }
        } else {
          // No auth - default to offline mode
          goOffline();
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        if (mounted) goOffline();
      } finally {
        if (mounted) setChecking(false);
      }
    };

    checkAuth();
    return () => { mounted = false; };
  }, [setAuth, goOffline]);

  // The window starts hidden (tauri.conf.json visible:false) so the user
  // never sees an unpainted white surface. Reveal once React has painted.
  useEffect(() => {
    if (checking) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        getCurrentWindow().show().catch((err) => {
          // Don't hide this: if show() is denied the window only appears via
          // the Rust failsafe, several seconds late.
          console.error('Window show failed:', err);
        });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [checking]);

  if (checking) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary)',
        color: 'var(--text-secondary)',
        gap: 12,
      }}>
        <div className="spinner" />
        <span>Checking authentication...</span>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <OnlineApp>{children}</OnlineApp>
    </ErrorBoundary>
  );
};
