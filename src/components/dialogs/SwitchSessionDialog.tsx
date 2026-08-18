import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../../store/instanceStore';
import { switchSession } from '../../lib/sessionActions';
import { openSessionIds } from '../../lib/openSession';
import type { SessionInfo } from '../../types/session';

interface SwitchSessionDialogProps {
  isOpen: boolean;
  /** Panel being re-pointed */
  instanceId: string;
  onClose: () => void;
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Re-point an existing panel at a different conversation — the repair for a
 * panel that got pinned to the wrong session, without losing its name, color
 * or place in the layout.
 */
export const SwitchSessionDialog: React.FC<SwitchSessionDialogProps> = ({
  isOpen,
  instanceId,
  onClose,
}) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const currentSid = instance?.claudeSessionId ?? '';
  const panelCwd = instance?.config.cwd ?? '';

  useEffect(() => {
    if (!isOpen) return;
    setFilter('');
    setLoading(true);
    invoke<SessionInfo[]>('session_list_recent')
      .then((all) => setSessions(all.filter((s) => s.hasFile && s.project)))
      .catch((err) => console.error('Failed to list sessions:', err))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Escape closes the dialog (it lives outside App's dialog chain).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Ids held by OTHER panels are not selectable — a second panel on the same
  // file rewinds and interleaves it. The panel's own current session is
  // marked instead.
  const takenElsewhere = useMemo(() => {
    const ids = openSessionIds();
    ids.delete(currentSid);
    return ids;
  }, [isOpen, currentSid]);

  const ordered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matches = q
      ? sessions.filter((s) =>
          s.display.toLowerCase().includes(q) ||
          s.project.toLowerCase().includes(q) ||
          s.sessionId.toLowerCase().includes(q))
      : sessions;
    // This panel's own folder first, then everything else by recency.
    const target = normPath(panelCwd);
    return [...matches].sort((a, b) => {
      const am = normPath(a.project) === target ? 0 : 1;
      const bm = normPath(b.project) === target ? 0 : 1;
      return am - bm || b.timestamp - a.timestamp;
    });
  }, [sessions, filter, panelCwd]);

  if (!isOpen) return null;

  const pick = async (s: SessionInfo) => {
    if (busy || takenElsewhere.has(s.sessionId) || s.sessionId === currentSid) return;
    setBusy(true);
    try {
      await switchSession(instanceId, { sessionId: s.sessionId, project: s.project });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dialog-header">
          <h3 className="dialog-title">
            Switch session — {instance?.name ?? 'panel'}
          </h3>
          <button className="dialog-close-btn" onClick={onClose}>{'×'}</button>
        </div>

        <div className="dialog-body" style={{ overflowY: 'auto', flex: 1 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
            The panel keeps its name, color and place — only the conversation changes.
            Sessions from this panel's folder are listed first.
          </p>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by text, folder or session id..."
            style={{
              width: '100%', padding: '7px 10px', marginBottom: 10,
              border: '1px solid var(--border)', borderRadius: 4,
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              fontSize: 13, boxSizing: 'border-box',
            }}
          />

          {loading && (
            <div style={{ color: 'var(--text-secondary)', padding: 12, textAlign: 'center' }}>
              Scanning sessions...
            </div>
          )}
          {!loading && ordered.length === 0 && (
            <div style={{ color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
              No sessions found.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ordered.map((s) => {
              const isCurrent = s.sessionId === currentSid;
              const isTaken = takenElsewhere.has(s.sessionId);
              const disabled = isCurrent || isTaken || busy;
              return (
                <div
                  key={s.sessionId}
                  onClick={() => pick(s)}
                  style={{
                    padding: '9px 12px',
                    background: 'var(--bg-elevated)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled && !isCurrent ? 0.45 : 1,
                    border: isCurrent
                      ? '1px solid var(--accent-border, rgba(74,158,255,0.4))'
                      : '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span className="truncate" style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                      {s.display || s.sessionId}
                    </span>
                    {isCurrent && (
                      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: 'rgba(74,158,255,0.15)', color: 'var(--accent)' }}>
                        current
                      </span>
                    )}
                    {isTaken && (
                      <span
                        title="Open in another panel — a session can only live in one panel"
                        style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}
                      >
                        in use
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
                    <span className="truncate" style={{ flex: 1, marginRight: 12 }}>{s.project}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {new Date(s.timestamp * 1000).toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};
