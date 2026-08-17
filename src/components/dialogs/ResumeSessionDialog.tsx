import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../../store/instanceStore';
import { openSession, openSessionIds } from '../../lib/openSession';
import type { SessionInfo } from '../../types/session';

interface ResumeSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ResumeSessionDialog: React.FC<ResumeSessionDialogProps> = ({ isOpen, onClose }) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ids already open in a panel. Resuming one of those must focus the panel,
  // not spawn a second process on the same session file — two writers rewind
  // and interleave the conversation. Recomputed while the dialog is open so
  // the badges are right even if panels changed underneath it.
  const instances = useInstanceStore((s) => s.instances);
  const alreadyOpen = useMemo(() => openSessionIds(), [instances, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setError(null);

    // session_list_recent filters out sessions whose JSONL no longer exists —
    // resuming those is guaranteed to fail ("No conversation found …").
    invoke<SessionInfo[]>('session_list_recent')
      .then((result) => {
        setSessions(result.filter((s) => s.hasFile && s.project));
      })
      .catch((err) => {
        console.error('Failed to scan sessions:', err);
        setError(String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = sessions.filter((s) => {
    if (!filter) return true;
    const lower = filter.toLowerCase();
    return (
      s.display.toLowerCase().includes(lower) ||
      s.project.toLowerCase().includes(lower) ||
      s.sessionId.toLowerCase().includes(lower)
    );
  });

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts * 1000);
    return date.toLocaleString();
  };

  const handleSelect = (session: SessionInfo) => {
    if (!session.project) return;
    // openSession dedupes: if this id is already open in a panel it focuses
    // that panel instead of opening a duplicate.
    openSession({
      cwd: session.project,
      sessionId: session.sessionId,
      panelView: 'chat',
      name: session.display.slice(0, 40) || 'Resumed Session',
    });
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 540, maxHeight: '80vh' }}>
        <h2>Resume Session</h2>

        <div className="form-group">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by project path or session text..."
          />
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, justifyContent: 'center' }}>
            <div className="spinner" />
            <span style={{ color: 'var(--text-secondary)' }}>Scanning sessions...</span>
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--error)', fontSize: 13, padding: 12 }}>
            Failed to load sessions: {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
            No sessions found.
          </div>
        )}

        <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map((session) => (
            <div
              key={session.sessionId}
              onClick={() => handleSelect(session)}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-elevated)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'background 100ms ease',
                border: '1px solid transparent',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)';
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent-border)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)';
                (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent';
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="truncate" style={{ flex: 1 }}>
                  {session.display || session.sessionId}
                </span>
                {alreadyOpen.has(session.sessionId) && (
                  <span
                    title="This conversation is already open — selecting it focuses that panel"
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '1px 6px',
                      borderRadius: 8,
                      background: 'rgba(74, 158, 255, 0.15)',
                      color: 'var(--accent)',
                    }}
                  >
                    open
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
                <span className="truncate" style={{ flex: 1, marginRight: 12 }}>{session.project}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(session.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
