import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { SessionInfo } from '../../types/session';
import type { InstanceConfig } from '../../types/instance';

interface ResumeSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ResumeSessionDialog: React.FC<ResumeSessionDialogProps> = ({ isOpen, onClose }) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addInstance } = useInstanceStore();
  const { addPanel, setActiveTab } = useLayoutStore();
  const { settings } = useSettingsStore();

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
    const config: InstanceConfig = {
      cwd: session.project,
      model: settings.defaultModel,
      dangerouslySkipPermissions: settings.defaultSkipPermissions,
      permissionMode: settings.defaultPermissionMode,
      allowedTools: [],
      maxBudget: 0,
      systemPrompt: '',
      agentMode: false,
    };

    const id = addInstance(config, session.display.slice(0, 40) || 'Resumed Session');
    // Set the claude session ID for resumption
    useInstanceStore.getState().setClaudeSessionId(id, session.sessionId);
    addPanel(id);
    setActiveTab(id);
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    if (currentGroupId) {
      useGroupStore.getState().addToGroup(currentGroupId, id);
    }
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
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }} className="truncate">
                {session.display || session.sessionId}
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
