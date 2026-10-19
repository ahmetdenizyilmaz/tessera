import { memo, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Send } from 'lucide-react';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { PathCwdContext } from '../../lib/openPath';
import { remoteMessages, type RemoteMessage } from '../../lib/remoteConversation';

const MessageBody = memo(function MessageBody({ message }: { message: RemoteMessage }) {
  const [expanded, setExpanded] = useState(false);
  const text = message.content;
  return <div className={`remote-conversation-message ${message.role === 'user' ? 'user' : ''}`}>
    <div className="remote-conversation-role">{message.role ?? 'assistant'}</div>
    {expanded && text.length > 8000 ? <pre className="remote-conversation-long">{text}</pre>
      : <PathCwdContext.Provider value={null}><MarkdownRenderer content={text.slice(0, 8000)} /></PathCwdContext.Provider>}
    {text.length > 8000 && <button className="btn btn-secondary" onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Collapse message' : 'Show full message'}</button>}
  </div>;
});

export function RemoteConversation({ deviceId, panelId, connected, reachable, busy, refreshKey, terminal }: {
  deviceId: string; panelId: string; connected: boolean; reachable: boolean; busy: boolean; refreshKey: number; terminal: boolean;
}) {
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(8);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [revision, setRevision] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await invoke<{ messages?: unknown; note?: string }>('lan_read_panel', { deviceId, panelId, limit: 100 });
        if (cancelled) return;
        const next = remoteMessages(result.messages);
        setMessages(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
        setNote(result.note ?? ''); setError('');
      } catch (error) { if (!cancelled) setError(String(error)); }
      finally { if (!cancelled) { setLoading(false); timer = setTimeout(() => void refresh(), busy ? 2000 : 5000); } }
    };
    if (connected) void refresh();
    else setLoading(false);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deviceId, panelId, connected, busy, refreshKey, revision]);
  useEffect(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages]);
  const send = async () => {
    if (sending || !draft.trim() || !connected || !reachable) return;
    setSending(true);
    try {
      await invoke('lan_send_panel', { deviceId, panelId, message: draft });
      setDraft(''); setError(''); follow.current = true; setRevision(v => v + 1);
    } catch (error) { setError(String(error)); }
    finally { setSending(false); }
  };
  return <>
    {terminal && <div className="remote-terminal-notice">Recent conversation history · up to 100 messages. Switch to Terminal for direct typing.</div>}
    <div ref={scroll} className="remote-conversation" onScroll={() => {
      const node = scroll.current!; follow.current = node.scrollHeight - node.clientHeight - node.scrollTop < 60;
    }}>
      {messages.length > count && <button className="btn btn-secondary" onClick={() => {
        follow.current = false; setCount(n => n + 8);
      }}>Show earlier messages ({messages.length - count})</button>}
      {messages.slice(-count).map((message, index) => <MessageBody key={`${message.timestamp ?? ''}-${messages.length - Math.min(count, messages.length) + index}`} message={message} />)}
      {loading && <div role="status">Loading conversation…</div>}
      {!loading && !messages.length && <div>{note || 'No conversation yet.'}</div>}
    </div>
    {error && <div role="alert" className="remote-terminal-notice">{error}</div>}
    {!terminal && <div className="remote-conversation-compose">
      <textarea value={draft} onChange={e => setDraft(e.target.value)} disabled={!connected || !reachable}
        placeholder="Send a message to this remote panel…" onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
        }} />
      <button className="btn btn-primary" onClick={() => void send()} disabled={sending || !draft.trim() || !connected || !reachable} title="Send to remote panel"><Send size={14} /></button>
    </div>}
  </>;
}
