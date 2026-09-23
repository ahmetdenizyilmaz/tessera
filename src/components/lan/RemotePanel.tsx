import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Monitor, RefreshCw, Send, WifiOff, X } from 'lucide-react';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { ProviderIcon } from '../icons/ProviderIcons';
import { closeRemotePanel, splitRemotePanelId, useLanStore } from '../../store/lanStore';
import { RemoteTerminalView } from './RemoteTerminalView';
import { PanelShortcutBadge } from '../layout/PanelShortcutBadge';

interface TranscriptMessage {
  role?: string;
  content?: unknown;
  text?: unknown;
  timestamp?: string | null;
}

function messageText(message: TranscriptMessage): string {
  const value = message.content ?? message.text ?? '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => typeof part === 'string' ? part : (
      typeof part === 'object' && part && 'text' in part ? String((part as { text: unknown }).text) : ''
    )).filter(Boolean).join('\n');
  }
  return value == null ? '' : JSON.stringify(value, null, 2);
}

export function RemotePanel({ instanceId }: { instanceId: string }) {
  const parsed = useMemo(() => splitRemotePanelId(instanceId), [instanceId]);
  const peer = useLanStore((s) => s.status?.peers.find((p) => p.deviceId === parsed?.deviceId));
  const panel = peer?.panels.find((p) => p.id === parsed?.panelId);
  const isTerminal = panel?.kind === 'terminal';
  const [refreshKey, setRefreshKey] = useState(0);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!parsed || !peer?.connected) return;
    if (isTerminal) { setRefreshKey(key => key + 1); return; }
    setLoading(true);
    try {
      const result = await invoke<{ messages?: TranscriptMessage[] }>('lan_read_panel', {
        deviceId: parsed.deviceId,
        panelId: parsed.panelId,
        limit: 100,
      });
      setMessages(Array.isArray(result?.messages) ? result.messages : []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [parsed, peer?.connected, isTerminal]);

  useEffect(() => {
    if (isTerminal) return;
    void refresh();
    if (!peer?.connected) return;
    const timer = setInterval(() => void refresh(), panel?.busy ? 2000 : 5000);
    return () => clearInterval(timer);
  }, [refresh, peer?.connected, panel?.busy, isTerminal]);

  const send = async () => {
    const text = draft;
    if (!parsed || !text.trim() || !peer?.connected || sending) return;
    setSending(true);
    try {
      await invoke('lan_send_panel', { deviceId: parsed.deviceId, panelId: parsed.panelId, message: text });
      setDraft('');
      setError(null);
      setTimeout(() => void refresh(), 500);
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  };

  if (!parsed || !peer || !panel) {
    return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Remote panel information is unavailable.</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div className="terminal-toolbar" style={{ minHeight: 36, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ProviderIcon provider={panel.provider} size={16} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="panel-title-with-shortcut" style={{ fontSize: 12, fontWeight: 600 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{panel.name}</span>
            <PanelShortcutBadge panelId={instanceId} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 6 }}>
            <span>{peer.name}</span>
            {panel.model && <span>· {panel.model}</span>}
            <span>· {panel.status}</span>
          </div>
        </div>
        <span title={peer.connected ? 'Encrypted LAN connection active' : 'Remote computer offline'} style={{ color: peer.connected ? '#51cf66' : 'var(--text-muted)', display: 'flex' }}>
          {peer.connected ? <Monitor size={14} /> : <WifiOff size={14} />}
        </span>
        <button className="btn btn-secondary" onClick={() => void refresh()} disabled={!peer.connected || loading} style={{ padding: 4 }} title={isTerminal ? 'Refresh terminal screen' : 'Refresh transcript'}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
        <button className="btn btn-secondary" onClick={(event) => { event.stopPropagation(); closeRemotePanel(instanceId); }}
          onPointerDown={(event) => event.stopPropagation()} style={{ padding: 4 }}
          aria-label="Close remote panel locally" title="Close locally (keeps running on host)">
          <X size={13} />
        </button>
      </div>

        {!peer.connected && (
          <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)' }}>
            {peer.name} is offline. Tessera will reconnect automatically when both computers are available.
          </div>
        )}
      {isTerminal ? (
        <RemoteTerminalView deviceId={parsed.deviceId} panelId={parsed.panelId} connected={peer.connected}
          inputSupported={peer.registryReady !== false && panel.terminalInput === true} refreshKey={refreshKey} />
      ) : (
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((message, index) => {
          const role = message.role ?? 'assistant';
          return (
            <div key={`${message.timestamp ?? ''}-${index}`} style={{
              alignSelf: role === 'user' ? 'flex-end' : 'stretch',
              maxWidth: role === 'user' ? '85%' : '100%',
              padding: '8px 10px', borderRadius: 8,
              background: role === 'user' ? 'var(--accent-subtle, rgba(74,158,255,.12))' : 'var(--bg-surface)',
              border: '1px solid var(--border)', fontSize: 12,
            }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>{role}</div>
              <MarkdownRenderer content={messageText(message)} />
            </div>
          );
        })}
        {peer.connected && !loading && messages.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>No conversation yet.</div>}
      </div>
      )}

      {error && <div style={{ color: '#ff6b6b', fontSize: 11, padding: '4px 10px' }}>{error}</div>}
      {!isTerminal && <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
          }}
          disabled={!peer.connected || !panel.reachable}
          placeholder={peer.connected ? 'Send a message to this remote panel…' : 'Remote computer is offline'}
          style={{ flex: 1, minHeight: 38, maxHeight: 120, resize: 'vertical' }}
        />
        <button className="btn btn-primary" onClick={() => void send()} disabled={!draft.trim() || sending || !peer.connected || !panel.reachable} title="Send to remote panel">
          <Send size={14} />
        </button>
      </div>}
    </div>
  );
}
