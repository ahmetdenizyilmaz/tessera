import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../../store/instanceStore';
import { useOpenCodeStore } from '../../store/opencodeStore';
import { usePanelDraft } from '../../hooks/usePanelDraft';
import { ensureOpenCode, refreshOpenCode } from '../../lib/opencodeBridge';
import { restartOpenCode } from '../../lib/opencodeSessions';
import { closePanel } from '../../lib/panelCleanup';
import { startFork, takeForkOpeningMessage } from '../../lib/forkActions';
import { AgentPanelHeader } from '../terminal/AgentPanelHeader';
import { XTermView } from '../terminal/XTermView';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { ProviderIcon } from '../icons/ProviderIcons';
import type { OpenCodeMessage, OpenCodeQuestion } from '../../types/opencode';

export function OpenCodeMessageView({ message }: { message: OpenCodeMessage }) {
  const user = message.info.role === 'user';
  return <article className={`msg ${user ? 'msg--user codex-message-user' : 'msg--assistant codex-message'}`}>
    <div className={`msg-header${user ? ' msg-header--user' : ''}`}>
      {!user && <ProviderIcon provider="opencode" size={14} />}<span className="msg-label">{user ? 'You' : 'OpenCode'}</span>
    </div>
    <div className={`msg-body${user ? ' msg-body--user' : ''}`}>
      {message.parts.map(part => {
        if (part.type === 'text') return user ? <p key={part.id} className="msg-user-text">{part.text}</p> : <MarkdownRenderer key={part.id} content={part.text ?? ''} />;
        if (part.type === 'reasoning') return <details key={part.id} className="codex-tool"><summary>Reasoning</summary><MarkdownRenderer content={part.text ?? ''} /></details>;
        if (part.type === 'tool') return <details key={part.id} className="codex-tool" open={part.state?.status === 'running' || part.state?.status === 'error'}>
          <summary>{part.tool} · {part.state?.status} {part.state?.title && `· ${part.state.title}`}</summary>
          {part.state?.input && <pre>{JSON.stringify(part.state.input, null, 2)}</pre>}
          {part.state?.output && <pre>{part.state.output}</pre>}
          {part.state?.error && <p role="alert">{part.state.error}</p>}
        </details>;
        if (part.type === 'file') return <p key={part.id}>Attachment: {part.filename || part.mime || 'file'}</p>;
        return null;
      })}
      {message.info.error && <p role="alert" className="codex-error">{message.info.error.data?.message || message.info.error.name || 'The model request failed.'}</p>}
    </div>
  </article>;
}

function QuestionCard({ request, respond, disabled }: { request: OpenCodeQuestion; respond: (answers?: string[][]) => void; disabled: boolean }) {
  const [selected, setSelected] = useState<string[][]>(() => request.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => request.questions.map(() => ''));
  const answers = request.questions.map((q, i) => q.custom !== false && custom[i]?.trim() ? (q.multiple ? [...selected[i], custom[i].trim()] : [custom[i].trim()]) : selected[i]);
  return <div className="codex-request opencode-question">
    {request.questions.map((q, i) => <fieldset key={i} disabled={disabled}><legend>{q.header}: {q.question}</legend>
      {q.options.map(o => <label key={o.label} title={o.description}><input type={q.multiple ? 'checkbox' : 'radio'} name={`${request.id}-${i}`} checked={selected[i].includes(o.label)} onChange={() => {
        setSelected(prev => prev.map((v, index) => index !== i ? v : q.multiple ? v.includes(o.label) ? v.filter(x => x !== o.label) : [...v, o.label] : [o.label]));
        if (!q.multiple) setCustom(prev => prev.map((v, index) => index === i ? '' : v));
      }} /><span>{o.label}<small className="opencode-hint"> · {o.description}</small></span></label>)}
      {q.custom !== false && <input aria-label={`Your answer: ${q.header}`} className="form-input" placeholder="Or write your own answer" value={custom[i]} onChange={e => setCustom(prev => prev.map((v, index) => i === index ? e.target.value : v))} />}
    </fieldset>)}
    <div className="form-row"><button className="btn btn-primary" disabled={disabled || answers.some(a => !a?.length)} onClick={() => respond(answers)}>Send answers</button><button className="btn btn-secondary" disabled={disabled} onClick={() => respond()}>Dismiss</button></div>
  </div>;
}

export function OpenCodePanel({ instanceId }: { instanceId: string }) {
  const instance = useInstanceStore(s => s.instances.get(instanceId));
  const session = useOpenCodeStore(s => s.sessions[instanceId]);
  const [text, setText] = usePanelDraft(instanceId, 'text', '');
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const [responding, setResponding] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const error = (e: unknown) => useOpenCodeStore.getState().error(instanceId, String(e));
  const terminal = instance?.config.panelView === 'terminal';
  const terminalExited = terminal && ready && (instance?.status === 'stopped' || instance?.status === 'error');
  const busy = !!session && session.status.type !== 'idle';
  const requests = (session?.permissions.length ?? 0) + (session?.questions.length ?? 0);
  useEffect(() => {
    let active = true;
    ensureOpenCode(instanceId).then(() => { if (active) setReady(true); }).catch(error);
    return () => { active = false; };
  }, [instanceId]);
  useEffect(() => { if (follow.current && body.current) body.current.scrollTop = body.current.scrollHeight; }, [session?.messages, requests]);
  useEffect(() => {
    if (!ready || !session?.connected || busy || pending || !instance?.config.fork?.openingMessage) return;
    const opening = takeForkOpeningMessage(instanceId);
    if (!opening) return;
    setPending(true);
    invoke('opencode_send', { id: instanceId, text: opening }).then(() => refreshOpenCode(instanceId, true)).catch(error).finally(() => setPending(false));
  }, [ready, session?.connected, busy, pending, instance?.config.fork?.openingMessage, instanceId]);
  const send = async () => {
    if (!ready || !session?.connected || pending || busy || requests || !text.trim()) return;
    const sent = text;
    setPending(true); useOpenCodeStore.getState().error(instanceId, undefined);
    try {
      await invoke('opencode_send', { id: instanceId, text: sent });
      setText(current => current === sent ? '' : current); follow.current = true;
      await refreshOpenCode(instanceId, true);
    } catch (e) { error(e); }
    finally { setPending(false); }
  };
  const restart = async () => {
    setPending(true); setReady(false);
    try { await restartOpenCode(instanceId); setRestartKey(k => k + 1); setReady(true); }
    catch (e) { error(e); }
    finally { setPending(false); }
  };
  const respond = async (requestId: string, kind: string, reply?: string, answers?: string[][]) => {
    setResponding(true);
    try { await invoke('opencode_respond', { id: instanceId, requestId, kind, reply: reply ?? null, answers: answers ?? null }); await refreshOpenCode(instanceId, true); }
    catch (e) { error(e); }
    finally { setResponding(false); }
  };
  if (!instance) return null;
  return <section className="terminal-panel codex-panel opencode-panel" style={{ borderTopColor: instance.color }}>
    <AgentPanelHeader instanceId={instanceId} metadata={`OpenCode · ${instance.config.opencode?.provider} · ${instance.config.model}`}
      status={terminalExited ? 'TERMINAL CLOSED' : session?.connected ? requests ? 'NEEDS YOU' : busy ? 'WORKING' : 'READY' : session?.error ? 'ERROR' : 'STARTING'}
      statusColor={session?.connected ? requests ? '#ffd43b' : '#51cf66' : session?.error ? '#ff6b6b' : '#ffd43b'}
      onClose={() => void closePanel(instanceId)} onFork={() => void startFork(instanceId)}
      onRestart={!busy && !pending ? () => void restart() : undefined} restarting={pending && !ready}
      onStop={busy ? () => void invoke('opencode_interrupt', { id: instanceId }).then(() => refreshOpenCode(instanceId)).catch(error) : undefined}
      controls={<><small>{instance.config.cwd}</small><small>Agent: {instance.config.opencode?.agent} · Permissions: {instance.config.opencode?.permission === 'allow' ? 'Allow all tools' : 'Ask before actions'}</small><small>Provider and permissions are fixed for this panel. Create a new panel to change them.</small>{terminal && <small>Native OpenCode TUI. Use its model picker for models from this panel's provider.</small>}</>}
    />
    {session?.error && <div role="alert" className="codex-error">{session.error} {!session.connected && <button className="btn btn-secondary" disabled={pending} onClick={() => void restart()}>Retry / resume</button>}</div>}
    {terminalExited && session?.connected && <div className="codex-error">The terminal exited. Your OpenCode conversation is kept. <button className="btn btn-secondary" disabled={pending || busy} onClick={() => void restart()}>Reconnect terminal</button></div>}
    {session?.status.type === 'retry' && <p role="status" className="codex-error">{session.status.message || 'The provider is retrying…'}</p>}
    {terminal ? <div className="codex-terminal">{ready && session?.connected ? <XTermView key={restartKey} instanceId={instanceId} isVisible /> : <p className="codex-empty">{session?.error ? 'Reconnect to open the terminal.' : 'Starting OpenCode terminal…'}</p>}</div> : <>
      <div className="codex-transcript" ref={body} onScroll={() => { const el = body.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
        {session?.messages.map(message => <OpenCodeMessageView key={message.info.id} message={message} />)}
        {!session?.messages.length && <p className="codex-empty">{ready ? 'Ask OpenCode to work in this project.' : 'Connecting to OpenCode…'}</p>}
      </div>
      {!!requests && <div className="codex-requests" aria-label="OpenCode approvals and questions">
        {session?.permissions.map(p => <div className="codex-request" key={p.id}>
          <strong>Allow {p.permission}?</strong><pre>{p.patterns.join('\n')}</pre>
          <details><summary>Request details</summary><pre>{JSON.stringify(p.metadata, null, 2)}</pre></details>
          <div className="form-row"><button className="btn btn-primary" disabled={responding} onClick={() => void respond(p.id, 'permission', 'once')}>Allow once</button><button className="btn btn-secondary" disabled={responding} onClick={() => void respond(p.id, 'permission', 'always')}>Allow for session</button><button className="btn btn-secondary" disabled={responding} onClick={() => void respond(p.id, 'permission', 'reject')}>Reject</button></div>
        </div>)}
        {session?.questions.map(q => <QuestionCard key={q.id} request={q} disabled={responding} respond={answers => void respond(q.id, 'question', answers ? undefined : 'reject', answers)} />)}
      </div>}
      <footer className="chat-input-area codex-input"><div className="chat-input-row">
        <textarea ref={composer} className="chat-textarea" rows={2} aria-label="Message OpenCode" placeholder="Message OpenCode… (Enter to send, Shift+Enter for a new line)" value={text} disabled={!ready || !session?.connected} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button className="btn btn-primary" disabled={!ready || !session?.connected || pending || busy || !!requests || !text.trim()} onClick={() => void send()}>Send</button>
      </div>{busy && <p className="opencode-hint">{requests ? 'Waiting for your response above.' : 'OpenCode is working…'}</p>}</footer>
    </>}
  </section>;
}
