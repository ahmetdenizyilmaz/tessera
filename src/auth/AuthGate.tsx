import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '../store/authStore';
import { useRelaySync } from '../hooks/useRelaySync';
import { useRelayEvents } from '../hooks/useRelayEvents';
import { ErrorBoundary } from '../components/ErrorBoundary';

interface AuthGateProps {
  children: React.ReactNode;
}

// Wrapper that activates relay hooks when authenticated
const OnlineApp: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useRelaySync();
  useRelayEvents();
  return <>{children}</>;
};

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [checking, setChecking] = useState(true);
  const { isAuthenticated, offlineMode, setAuth, goOffline } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      try {
        const user = await invoke<{ id: string; email: string; name?: string } | null>('auth_check');
        if (!mounted) return;

        if (user) {
          const token = await invoke<string | null>('get_access_token');
          const serverUrl = await invoke<string | null>('get_server_url');

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

  // Authenticated: wrap with relay hooks
  if (isAuthenticated && !offlineMode) {
    return (
      <ErrorBoundary>
        <OnlineApp>{children}</OnlineApp>
      </ErrorBoundary>
    );
  }

  // Offline mode: render app directly
  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  );
};
