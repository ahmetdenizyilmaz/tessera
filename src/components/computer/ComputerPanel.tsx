import React, { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useComputerStore } from '../../store/computerStore';

interface ComputerPanelProps {
  instanceId: string;
}

export const ComputerPanel: React.FC<ComputerPanelProps> = ({ instanceId }) => {
  const session = useComputerStore((s) => s.getSession(instanceId));
  const addSession = useComputerStore((s) => s.addSession);
  const setActive = useComputerStore((s) => s.setActive);
  const [screenshotUrl, setScreenshotUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!session) {
      addSession(instanceId);
    }
  }, [instanceId, session, addSession]);

  const captureScreenshot = useCallback(async () => {
    try {
      // screenshot:// protocol serves JPEG screenshots with cache-busting
      const ts = Date.now();
      setScreenshotUrl(`screenshot://capture?t=${ts}`);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (session?.isActive && session.pollInterval > 0) {
      captureScreenshot();
      intervalRef.current = setInterval(captureScreenshot, session.pollInterval);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [session?.isActive, session?.pollInterval, captureScreenshot]);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      if (!imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      const x = Math.round(
        ((e.clientX - rect.left) / rect.width) * imgRef.current.naturalWidth
      );
      const y = Math.round(
        ((e.clientY - rect.top) / rect.height) * imgRef.current.naturalHeight
      );
      try {
        await invoke('computer_mouse_move', { x, y });
        await invoke('computer_mouse_click', { button: 'left' });
      } catch (err) {
        console.error('Computer click failed:', err);
      }
    },
    []
  );

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      try {
        await invoke('computer_key_type', { text: e.key });
      } catch (err) {
        console.error('Computer key failed:', err);
      }
    },
    []
  );

  const toggleActive = () => {
    if (session) {
      setActive(instanceId, !session.isActive);
    }
  };

  return (
    <div
      className="terminal-panel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      <div className="terminal-toolbar">
        <div
          className="color-dot"
          style={{ background: '#cc5de8' }}
        />
        <span className="instance-name">Computer Use</span>
        <button
          className={`btn ${session?.isActive ? 'btn-danger' : 'btn-primary'}`}
          onClick={toggleActive}
          style={{ fontSize: '11px', padding: '2px 8px' }}
        >
          {session?.isActive ? 'Stop' : 'Start'}
        </button>
      </div>
      <div
        className="terminal-content"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {error ? (
          <div style={{ color: 'var(--error)', padding: 16, textAlign: 'center' }}>
            {error}
          </div>
        ) : screenshotUrl ? (
          <img
            ref={imgRef}
            src={screenshotUrl}
            alt="Screenshot"
            onClick={handleClick}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              cursor: 'crosshair',
            }}
          />
        ) : (
          <div
            style={{
              color: 'var(--text-muted)',
              textAlign: 'center',
              padding: 24,
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>🖥</div>
            <div>Click "Start" to begin screen capture</div>
          </div>
        )}
      </div>
    </div>
  );
};
