import React from 'react';
import { useSessionStore } from '../../store/sessionStore';

interface SessionHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export const SessionHistoryDialog: React.FC<SessionHistoryDialogProps> = ({ isOpen, onClose }) => {
  const searchQuery = useSessionStore((s) => s.searchQuery);
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery);
  const getFilteredSessions = useSessionStore((s) => s.getFilteredSessions);
  const toggleFavorite = useSessionStore((s) => s.toggleFavorite);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  if (!isOpen) return null;

  const sessions = getFilteredSessions();

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="dialog-header">
          <h3 className="dialog-title">Session History</h3>
          <button className="dialog-close-btn" onClick={onClose}>x</button>
        </div>

        <div style={{ padding: '12px 16px 8px' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', fontSize: 13, padding: '6px 10px' }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32, fontSize: 13 }}>
              {searchQuery ? 'No sessions match your search.' : 'No saved sessions yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sessions.map((session) => (
                <div
                  key={session.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    fontSize: 13,
                  }}
                >
                  <button
                    onClick={() => toggleFavorite(session.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 16,
                      padding: 0,
                      lineHeight: 1,
                      color: session.isFavorite ? '#fbbf24' : 'var(--text-muted)',
                    }}
                    title={session.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {session.isFavorite ? '\u2605' : '\u2606'}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.projectPath}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {formatDate(session.endedAt)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                      {formatTime(session.startedAt)} - {formatTime(session.endedAt)}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, minWidth: 32, textAlign: 'right' }}>
                    {session.messageCount} msg
                  </div>

                  <button
                    onClick={() => deleteSession(session.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: '2px 4px',
                      color: 'var(--text-muted)',
                      borderRadius: 4,
                    }}
                    title="Delete session"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
