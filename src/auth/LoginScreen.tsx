import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '../store/authStore';

interface LoginScreenProps {
  onSuccess: () => void;
  onGoOffline: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess, onGoOffline }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const url = serverUrl.trim() || undefined;

      if (mode === 'login') {
        const result = await invoke<{ id: string; email: string; name?: string; accessToken: string; serverUrl: string }>(
          'auth_login',
          { email, password, serverUrl: url },
        );
        setAuth({ id: result.id, email: result.email, name: result.name }, result.accessToken, result.serverUrl);
      } else {
        const result = await invoke<{ id: string; email: string; name?: string; accessToken: string; serverUrl: string }>(
          'auth_register',
          { email, password, name, serverUrl: url },
        );
        setAuth({ id: result.id, email: result.email, name: result.name }, result.accessToken, result.serverUrl);
      }

      onSuccess();
    } catch (err) {
      console.error('Auth failed:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'var(--bg-primary)',
      fontFamily: 'var(--font-ui)',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius-md)',
        padding: 32,
        width: 380,
        boxShadow: '0 16px 48px var(--shadow)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            Claude GUI
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
          )}

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
            />
          </div>

          <div className="form-group">
            <label>Server URL (optional)</label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://relay.example.com"
            />
          </div>

          {error && (
            <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', padding: '8px 16px', fontSize: 14, marginBottom: 12 }}
          >
            {loading ? 'Please wait...' : (mode === 'login' ? 'Sign In' : 'Register')}
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            style={{ color: 'var(--accent)', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
          </button>

          <button
            onClick={onGoOffline}
            style={{ color: 'var(--text-muted)', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Go Offline
          </button>
        </div>
      </div>
    </div>
  );
};
