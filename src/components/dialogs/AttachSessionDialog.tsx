import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PanelViewPreview } from '../icons/PanelViewPreview';
import { openSession, parseResumeCommand, openSessionIds, folderName } from '../../lib/openSession';
import type { PanelView } from '../../lib/openSession';
import type { SessionInfo } from '../../types/session';

interface AttachSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Set when opened by dropping a folder — that project is offered first */
  initialCwd?: string | null;
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function relativeTime(ts: number): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Bring a Claude session that was started outside the app (a terminal, another
 * window) into a panel here. A live process cannot be adopted, but resuming by
 * session id continues the same conversation.
 */
export const AttachSessionDialog: React.FC<AttachSessionDialogProps> = ({
  isOpen,
  onClose,
  initialCwd,
}) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setPasteText('');
    setPasteError(null);
    setFilter('');
    setLoading(true);
    invoke<SessionInfo[]>('session_list_recent')
      .then((all) => {
        const open = openSessionIds();
        setSessions(all.filter((s) => s.hasFile && s.project && !open.has(s.sessionId)));
      })
      .catch((err) => console.error('Failed to list sessions:', err))
      .finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const ordered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matches = q
      ? sessions.filter((s) =>
          s.display.toLowerCase().includes(q) ||
          s.project.toLowerCase().includes(q) ||
          s.sessionId.toLowerCase().includes(q))
      : sessions;
    if (!initialCwd) return matches;
    // Dropped-folder flow: that project's sessions first
    const target = normPath(initialCwd);
    return [...matches].sort((a, b) => {
      const am = normPath(a.project) === target ? 0 : 1;
      const bm = normPath(b.project) === target ? 0 : 1;
      return am - bm || b.timestamp - a.timestamp;
    });
  }, [sessions, filter, initialCwd]);

  if (!isOpen) return null;

  const attachSession = (s: SessionInfo, panelView: PanelView) => {
    openSession({
      cwd: s.project,
      sessionId: s.sessionId,
      panelView,
      name: folderName(s.project),
    });
    onClose();
  };

  const attachPasted = (panelView: PanelView) => {
    const parsed = parseResumeCommand(pasteText);
    if (!parsed) {
      setPasteError('Could not find a session id. Paste the whole /resume command, or just the id.');
      return;
    }
    const known = sessions.find((s) => s.sessionId === parsed.sessionId);
    const cwd = parsed.cwd ?? known?.project;
    if (!cwd) {
      setPasteError('That session is not on disk and the command has no directory — include the cd part.');
      return;
    }
    openSession({ cwd, sessionId: parsed.sessionId, panelView, name: folderName(cwd) });
    onClose();
  };

  const startFresh = (panelView: PanelView) => {
    if (!initialCwd) return;
    openSession({ cwd: initialCwd, panelView, name: folderName(initialCwd) });
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 620, maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dialog-header">
          <h3 className="dialog-title">Attach a Claude session</h3>
          <button className="dialog-close-btn" onClick={onClose}>{'\u00D7'}</button>
        </div>

        <div className="dialog-body" style={{ overflowY: 'auto', flex: 1 }}>
          <p className="attach-hint">
            A session running in another terminal keeps its own process, but its conversation
            continues here — pick Chat or Terminal for each one.
          </p>

          {initialCwd && (
            <div className="attach-section">
              <div className="attach-section__title">Dropped folder</div>
              <div className="attach-row">
                <div className="attach-row__main">
                  <div className="attach-row__name">{folderName(initialCwd)}</div>
                  <div className="attach-row__path">{initialCwd}</div>
                </div>
                <ViewButtons onPick={startFresh} label="New session" />
              </div>
            </div>
          )}

          <div className="attach-section">
            <div className="attach-section__title">Paste a resume command</div>
            <input
              className="form-input"
              type="text"
              value={pasteText}
              placeholder="cd 'C:\path' ; claude --resume 9fd91c4b-…   (or just the id)"
              onChange={(e) => { setPasteText(e.target.value); setPasteError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) attachPasted('chat'); }}
            />
            {pasteError && <div className="attach-error">{pasteError}</div>}
            {pasteText.trim() && (
              <div style={{ marginTop: 8 }}>
                <ViewButtons onPick={attachPasted} label="Attach" />
              </div>
            )}
          </div>

          <div className="attach-section">
            <div className="attach-section__title">
              Sessions not open here {loading ? '' : `(${ordered.length})`}
            </div>
            <input
              className="form-input"
              type="text"
              value={filter}
              placeholder="Filter by project or text…"
              onChange={(e) => setFilter(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {loading && <div className="attach-empty">Scanning…</div>}
            {!loading && ordered.length === 0 && (
              <div className="attach-empty">No other sessions found.</div>
            )}
            {ordered.slice(0, 60).map((s) => (
              <div key={s.sessionId} className="attach-row">
                <div className="attach-row__main">
                  <div className="attach-row__name">{s.display || folderName(s.project)}</div>
                  <div className="attach-row__path">
                    {s.project} · {relativeTime(s.timestamp)}
                  </div>
                </div>
                <ViewButtons onPick={(v) => attachSession(s, v)} label="Open as" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/** The Chat/Terminal pair, using the same previews as the New Panel menu */
const ViewButtons: React.FC<{ onPick: (v: PanelView) => void; label: string }> = ({
  onPick,
  label,
}) => (
  <div className="attach-views" title={label}>
    {(['chat', 'terminal'] as const).map((kind) => (
      <button
        key={kind}
        className="attach-view-btn"
        onClick={() => onPick(kind)}
        title={kind === 'chat' ? 'Open as chat panel' : 'Open as terminal panel'}
      >
        <PanelViewPreview kind={kind} size={40} />
        <span>{kind === 'chat' ? 'Chat' : 'Terminal'}</span>
      </button>
    ))}
  </div>
);

export default AttachSessionDialog;
