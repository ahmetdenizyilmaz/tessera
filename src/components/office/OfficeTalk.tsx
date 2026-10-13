import { useState, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowUpRight, MessagesSquare, Send } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { useInstanceStore } from '../../store/instanceStore';
import { useOfficeTalkStore } from '../../lib/officeTalk';
import type { ClaudeInstance } from '../../types/instance';

/** Type to the agent from the office. Routed by Rust like a panel message
 * (stream, Codex, OpenCode, Antigravity, or a terminal paste), so the panel
 * itself never has to be opened. */
export function OfficeComposer({ instance, onOpen }: { instance: ClaudeInstance; onOpen: (id: string) => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const routable = !instance.config.llmConfig;
  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true); setError('');
    try { await invoke('panel_send_text', { id: instance.id, text: message }); setText(''); }
    catch (e) { setError(String(e)); }
    finally { setSending(false); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } };
  if (!routable) return <footer className="office-chat-footer"><span>API chats are answered from the full chat.</span><button onClick={() => onOpen(instance.id)}>Open full chat<ArrowUpRight size={15} /></button></footer>;
  return <footer className="office-chat-footer office-chat-footer--composer">
    {error && <p className="office-chat-error" role="alert">{error}</p>}
    <div className="office-composer">
      <textarea aria-label={`Message ${instance.name}`} placeholder={`Message ${instance.name}… (Enter to send)`} value={text} rows={2} disabled={sending}
        onChange={e => setText(e.target.value)} onKeyDown={onKey} />
      <button aria-label="Send" title="Send" disabled={sending || !text.trim()} onClick={() => void send()}><Send size={15} /></button>
      <button aria-label="Open full chat" title="Open full chat" onClick={() => onOpen(instance.id)}><ArrowUpRight size={15} /></button>
    </div>
  </footer>;
}

/** Ask this agent to talk a topic through with another agent over the panel
 * MCP tools. The instructions name the tool so any provider with the
 * `tessera-panels` server can follow them. */
export function OfficeHuddle({ instance }: { instance: ClaudeInstance }) {
  const workers = useOfficeGameStore(s => s.workers);
  const instances = useInstanceStore(s => s.instances);
  const [open, setOpen] = useState(false);
  const [partner, setPartner] = useState('');
  const [topic, setTopic] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const others = Object.keys(workers).map(id => instances.get(id)).filter((i): i is ClaudeInstance => !!i && i.id !== instance.id && !i.config.llmConfig);
  if (instance.config.llmConfig || !others.length) return null;
  const start = async () => {
    const other = instances.get(partner); const subject = topic.trim();
    if (!other || !subject || sending) return;
    setSending(true); setStatus('');
    const text = `Please discuss this with the panel named "${other.name}" using the tessera-panels tools: call send_to_panel with wait_for_reply true, read the reply, and continue until you agree or have each made your point (at least one reply each). Then tell me the outcome here in a few lines.\n\nTopic: ${subject}`;
    try { await invoke('panel_send_text', { id: instance.id, text }); setStatus(`Asked ${instance.name} to talk with ${other.name}.`); setTopic(''); setOpen(false); }
    catch (e) { setStatus(String(e)); }
    finally { setSending(false); }
  };
  return <div className="office-huddle">
    <button className="office-huddle-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}><MessagesSquare size={13} />Talk with another agent</button>
    {open && <div className="office-huddle-form">
      <label>With<select aria-label="Agent to talk with" value={partner} onChange={e => setPartner(e.target.value)}><option value="">Choose an agent</option>{others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <textarea aria-label="Topic to discuss" placeholder="What should they work out together?" rows={2} value={topic} onChange={e => setTopic(e.target.value)} />
      <div className="office-huddle-actions"><small>They talk through the panel MCP tools; you see it as bubbles here and in both chats.</small><button disabled={!partner || !topic.trim() || sending} onClick={() => void start()}>Start</button></div>
    </div>}
    {status && <p className="office-huddle-status" role="status">{status}</p>}
  </div>;
}

/** The recent panel-to-panel messages this agent sent or received. */
export function OfficeExchanges({ id }: { id: string }) {
  const exchanges = useOfficeTalkStore(s => s.exchanges);
  const mine = exchanges.filter(e => e.from === id || e.to === id).slice(0, 6);
  if (!mine.length) return null;
  const ago = (at: number) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
  return <div className="office-exchanges"><span className="office-eyebrow">AGENT TALK</span>
    {mine.map(e => <div key={e.id} className="office-exchange" title={e.preview}><b>{e.from === id ? `→ ${e.toName}` : `← ${e.fromName}`}</b><span>{e.preview}</span><small>{ago(e.at)}</small></div>)}
  </div>;
}
