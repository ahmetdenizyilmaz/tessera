import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowDown, ArrowUpRight, ChevronDown, MessageSquare, X } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useCodexStore } from '../../store/codexStore';
import { useOpenCodeStore } from '../../store/opencodeStore';
import { useAntigravityStore } from '../../store/antigravityStore';
import { useLlmChatStore } from '../../store/llmChatStore';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { officeProvider, PROVIDER_NAMES } from '../../lib/officeActivity';
import { OFFICE_CATALOG } from '../../lib/officeCatalog';
import { historyItems } from '../../lib/codexReducer';
import { stripForkPreamble } from '../../lib/forkTranscript';
import { ACTIVITY_LABELS, getProviderColor } from '../../engine/SpriteManager';
import { ChatMessage } from '../chat/ChatMessage';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { CodexItemView } from '../codex/CodexItemView';
import { OpenCodeMessageView } from '../opencode/OpenCodeMessageView';
import { AntigravityItemView } from '../antigravity/AntigravityItemView';
import { CharacterPortrait } from './OfficeTeam';
import type { ClaudeInstance } from '../../types/instance';
import type { CodexItem, CodexThread } from '../../types/codex';
import type { OpenCodeSnapshot } from '../../types/opencode';
import type { AntigravitySnapshot } from '../../types/antigravity';

interface HistoryMessage { role: string; content: string; timestamp?: string | null }
interface History { claude?: HistoryMessage[]; codex?: CodexItem[]; opencode?: OpenCodeSnapshot; antigravity?: AntigravitySnapshot }

function TranscriptMessage({ role, text, provider }: { role: string; text: string; provider: string }) {
  return <article className={`msg msg--${role === 'user' ? 'user' : 'assistant'}`}>
    <div className={`msg-header${role === 'user' ? ' msg-header--user' : ''}`}><span className="msg-label">{role === 'user' ? 'You' : role === 'system' ? 'System' : provider}</span></div>
    <div className={`msg-body msg-body--${role === 'user' ? 'user' : 'assistant'}`}>
      {role === 'user' ? <p className="msg-user-text">{stripForkPreamble(text)}</p> : <MarkdownRenderer content={text} />}
    </div>
  </article>;
}

/** Observe the existing sessions. Opening this view never configures a provider,
 * starts a turn, mounts a second terminal, or registers a second stream consumer. */
export function OfficeChat({ instance, onClose, onOpen }: { instance: ClaudeInstance; onClose: () => void; onOpen: (id: string) => void }) {
  const id = instance.id, provider = officeProvider(instance), providerName = PROVIDER_NAMES[provider] ?? provider;
  const claude = useChatStore(s => s.sessions.get(id));
  const codex = useCodexStore(s => s.sessions[id]);
  const opencode = useOpenCodeStore(s => s.sessions[id]);
  const antigravity = useAntigravityStore(s => s.sessions[id]);
  const llm = useLlmChatStore(s => s.conversations[id]);
  const worker = useOfficeGameStore(s => s.workers[id]);
  const profile = useOfficeGameStore(s => s.profiles[id]);
  const purchased = useOfficeGameStore(s => s.purchasedItems);
  const [history, setHistory] = useState<History>({});
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [following, setFollowing] = useState(true);
  const follow = useRef(true), body = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const isLlm = !!instance.config.llmConfig;
  const terminal = instance.config.panelView === 'terminal';
  const claudeHistory = !isLlm && provider === 'claude' && (terminal || !claude?.messages.length);
  const codexHistory = !isLlm && provider === 'codex' && !codex?.items.length;
  const openCodeHistory = !isLlm && provider === 'opencode' && !opencode;
  const antigravityHistory = !isLlm && provider === 'antigravity' && !antigravity;
  const sid = instance.claudeSessionId, threadId = instance.codexThreadId, cwd = instance.config.cwd;
  const executable = instance.config.codex?.executablePath;
  const read = useCallback(async (): Promise<History> => {
    if (claudeHistory && sid) return { claude: await invoke<HistoryMessage[]>('session_load_history', { sessionId: sid, projectPath: cwd }) };
    if (codexHistory && threadId) {
      const result = await invoke<{ thread: CodexThread }>('codex_read_thread', { threadId, executablePath: executable || null });
      return { codex: result?.thread ? historyItems(result.thread) : [] };
    }
    if (openCodeHistory) return { opencode: await invoke<OpenCodeSnapshot>('opencode_snapshot', { id, knownRevision: null }) };
    if (antigravityHistory) return { antigravity: (await invoke<AntigravitySnapshot | null>('antigravity_snapshot', { id, knownRevision: null })) ?? undefined };
    return {};
  }, [id, claudeHistory, codexHistory, openCodeHistory, antigravityHistory, sid, threadId, cwd, executable]);
  const needsHistory = (claudeHistory && !!sid) || (codexHistory && !!threadId) || openCodeHistory || antigravityHistory;
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    setHistory({}); setReadError(''); setLoading(needsHistory);
    if (!needsHistory) return;
    const poll = async () => {
      try { const data = await read(); if (active) { setHistory(data); setReadError(''); } }
      catch (e) { if (active) setReadError(`Could not load this conversation: ${String(e)}`); }
      finally { if (active) { setLoading(false); timer = setTimeout(() => void poll(), 2000); } }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [read, needsHistory]);

  const scrollToLatest = useCallback(() => {
    follow.current = true; setFollowing(true);
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, []);
  // Content resizes as Markdown, tool results, and streaming messages arrive.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => { if (follow.current && body.current) body.current.scrollTop = body.current.scrollHeight; });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);

  const historicClaude = history.claude ?? instance.config.fork?.transcript ?? [];
  const claudeMessages = terminal ? [] : claude?.messages ?? [];
  const codexItems = codex?.items.length ? codex.items : history.codex ?? [];
  const openCodeSession = opencode ?? history.opencode;
  const antigravitySession = antigravity ?? history.antigravity;
  const count = isLlm ? llm?.messages.length ?? 0 : provider === 'codex' ? codexItems.length : provider === 'antigravity' ? antigravitySession?.items.length ?? 0 : provider === 'opencode' ? openCodeSession?.messages.length ?? 0 : claudeMessages.length || historicClaude.length;
  const error = readError || (isLlm ? llm?.error : provider === 'codex' ? codex?.error : provider === 'antigravity' ? antigravitySession?.error : provider === 'opencode' ? openCodeSession?.error : claude?.error);
  const needsYou = worker?.activity === 'awaiting_permission';
  const busy = isLlm ? llm?.isStreaming : provider === 'codex' ? codex?.busy : provider === 'antigravity' ? antigravitySession?.busy : provider === 'opencode' ? openCodeSession && openCodeSession.status.type !== 'idle' : claude?.isStreaming;

  return <aside className="office-chat" aria-label={`Chat with ${instance.name}`}>
    <header className="office-chat-heading">
      <CharacterPortrait id={profile?.appearanceId ?? id} color={`#${getProviderColor(provider).toString(16).padStart(6, '0')}`} accessory={profile?.accessory} />
      <div><span className="office-eyebrow">AGENT CONVERSATION</span><h3>{instance.name}</h3><p>{providerName} · {instance.config.llmConfig?.model ?? instance.config.model}</p></div>
      <button aria-label="Close agent chat" title="Close chat (Esc)" onClick={onClose}><X size={18} /></button>
    </header>
    <details className="office-chat-profile">
      <summary><span className={`office-state-dot ${worker?.activity ?? 'unknown'}`} />{worker ? ACTIVITY_LABELS[worker.activity] : 'Offline'}<span>Agent details</span><ChevronDown size={13} /></summary>
      {worker?.task && <p>{worker.task}</p>}
      <div className="office-chat-stats">{profile?.tasks ?? 0} completed turns · {profile?.coins ?? 0} coins earned</div>
      <label className="office-accessory">Accessory<select aria-label={`Accessory for ${instance.name}`} value={profile?.accessory ?? ''} onChange={e => useOfficeGameStore.getState().equip(id, e.target.value)}><option value="">None</option>{OFFICE_CATALOG.filter(i => i.category === 'accessory' && purchased.includes(i.id)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    </details>
    {error && <p className="office-chat-error" role="alert">{error}</p>}
    <div ref={body} className="office-chat-messages" role="region" aria-label="Agent conversation" tabIndex={0} onScroll={() => {
      const el = body.current!; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; setFollowing(follow.current);
    }}>
      <div ref={content}>
        {isLlm ? llm?.messages.map(m => <TranscriptMessage key={m.id} role={m.role} text={m.content} provider={providerName} />)
          : provider === 'codex' ? codexItems.map(item => <CodexItemView key={item.id} item={item} />)
          : provider === 'antigravity' ? antigravitySession?.items.map(item => <AntigravityItemView key={item.id} item={item} />)
          : provider === 'opencode' ? openCodeSession?.messages.map(message => <OpenCodeMessageView key={message.info.id} message={message} />)
          : claudeMessages.length ? claudeMessages.map((message, i) => <ChatMessage key={message.id} message={message} isContinuation={message.role === 'assistant' && claudeMessages[i - 1]?.role === 'assistant'} isGroupEnd={claudeMessages[i + 1]?.role !== 'assistant'} />)
          : historicClaude.map((m, i) => <TranscriptMessage key={i} role={m.role} text={m.content} provider={providerName} />)}
        {!count && <div className="office-chat-empty"><MessageSquare size={24} /><p>{loading ? 'Loading conversation…' : 'No messages to show yet.'}</p><small>{loading ? 'Reading this agent’s conversation.' : 'Open the full chat to start or resume this agent.'}</small></div>}
        {busy && <p className="office-chat-working" role="status"><span className="office-live-dot" />{providerName} is working…</p>}
      </div>
    </div>
    {!following && <button className="office-chat-latest" onClick={scrollToLatest}><ArrowDown size={13} />Latest messages</button>}
    <footer className="office-chat-footer"><span>{needsYou ? 'This agent needs your input.' : 'Conversation updates as your agent works.'}</span><button onClick={() => onOpen(id)}>Open full chat<ArrowUpRight size={15} /></button></footer>
  </aside>;
}
