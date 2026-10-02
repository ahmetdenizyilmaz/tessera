import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../../store/instanceStore';
import { useAntigravityStore } from '../../store/antigravityStore';
import { usePanelDraft } from '../../hooks/usePanelDraft';
import { ensureAntigravity, reconfigureAntigravity, refreshAntigravity } from '../../lib/antigravityBridge';
import { newAntigravityConversation, openAntigravitySession, restartAntigravity } from '../../lib/antigravitySessions';
import { discoverAntigravity } from '../../lib/antigravityDiscovery';
import { ANTIGRAVITY_PERMISSIONS, antigravityModelLabel, antigravityStatus, formatAntigravityUsage } from '../../lib/antigravityConfig';
import { closePanel } from '../../lib/panelCleanup';
import { markForkConsumed, peekForkContext, startFork, takeForkOpeningMessage } from '../../lib/forkActions';
import { AgentPanelHeader } from '../terminal/AgentPanelHeader';
import { XTermView } from '../terminal/XTermView';
import { ForkNotice } from '../chat/ForkNotice';
import { AntigravityItemView } from './AntigravityItemView';
import type { AntigravityDiscovery, AntigravityOptions, AntigravityPermission, AntigravitySnapshot } from '../../types/antigravity';

/** Mounted only while the panel menu is open, so the CLI is asked for models on demand. */
function Controls({ instanceId, session, terminal, apply }: { instanceId: string; session?: AntigravitySnapshot; terminal: boolean; apply: (change: Partial<AntigravityOptions>) => void }) {
  const instance = useInstanceStore(s => s.instances.get(instanceId));
  const [discovery, setDiscovery] = useState<AntigravityDiscovery | null>(null);
  const options = instance?.config.antigravity;
  useEffect(() => {
    let active = true;
    discoverAntigravity(options?.executablePath ?? '').then(d => { if (active) setDiscovery(d); }).catch(() => {});
    return () => { active = false; };
  }, [options?.executablePath]);
  if (!instance || !options) return null;
  const models = discovery?.models ?? [];
  const locked = !!session?.busy;
  return <>
    <small>{instance.config.cwd}</small>
    <div className="toolbar-menu-row codex-model-controls">
      <select aria-label="Antigravity model" value={instance.config.model} disabled={locked} onChange={e => apply({ model: e.target.value })}>
        <option value="">agy's saved default model</option>
        {!!instance.config.model && !models.some(m => m.id === instance.config.model) && <option value={instance.config.model}>{instance.config.model}</option>}
        {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <select aria-label="Antigravity permissions" value={options.permission} disabled={locked} onChange={e => apply({ permission: e.target.value as AntigravityPermission })}>
        {(Object.keys(ANTIGRAVITY_PERMISSIONS) as AntigravityPermission[]).map(mode => <option key={mode} value={mode}>{ANTIGRAVITY_PERMISSIONS[mode].label}</option>)}
      </select>
      <label className="form-checkbox-label"><input type="checkbox" checked={options.sandbox} disabled={locked} onChange={e => apply({ sandbox: e.target.checked })} /> agy sandbox</label>
    </div>
    <small>{terminal ? ANTIGRAVITY_PERMISSIONS[options.permission].terminal : ANTIGRAVITY_PERMISSIONS[options.permission].chat}</small>
    <small>{locked ? 'Settings can change when the current turn has finished.' : terminal ? 'Changing a setting restarts this terminal and resumes its conversation.' : 'Changes apply to the next message; the conversation is kept.'}</small>
    <small>Conversation: {session?.conversationId ?? 'not started yet'}{session?.permissionMode ? ` · agy reports ${session.permissionMode}` : ''}{session?.tools != null ? ` · ${session.tools} tools` : ''}</small>
    <small>{terminal ? 'Token usage is not available for terminal panels: agy reports it only through its headless chat interface.' : session?.usage ? `Conversation total reported by agy: ${formatAntigravityUsage(session.usage)}` : 'Conversation token usage: not reported yet.'}</small>
  </>;
}

export function AntigravityPanel({ instanceId }: { instanceId: string }) {
  const instance = useInstanceStore(s => s.instances.get(instanceId));
  const session = useAntigravityStore(s => s.sessions[instanceId]);
  const [text, setText] = usePanelDraft(instanceId, 'text', '');
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  // Refusals that are not session state (busy, panel limit): shown until the next action.
  const [notice, setNotice] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const terminal = instance?.config.panelView === 'terminal';
  const terminalExited = !!terminal && ready && (instance?.status === 'stopped' || instance?.status === 'error');
  const busy = !!session?.busy;
  const usable = ready && !!session?.configured;
  useEffect(() => {
    let active = true;
    ensureAntigravity(instanceId).then(() => { if (active) setReady(true); }).catch(() => {});
    return () => { active = false; };
  }, [instanceId]);
  useEffect(() => { if (follow.current && body.current) body.current.scrollTop = body.current.scrollHeight; }, [session?.items, session?.error]);

  const submit = async (message: string, clear = false) => {
    if (!usable || pending || busy || !message.trim()) return;
    setPending(true); setNotice('');
    // A forked panel carries the inherited conversation on its first message.
    const context = peekForkContext(instanceId);
    try {
      await invoke('antigravity_send', { id: instanceId, text: context ? `${context}\n\n${message}` : message });
      if (context) markForkConsumed(instanceId);
      if (clear) setText(current => current === message ? '' : current);
      follow.current = true;
    } catch (e) {
      // Turn failures are already in the transcript; anything else is shown here.
      await refreshAntigravity(instanceId, true).catch(() => {});
      if (!useAntigravityStore.getState().sessions[instanceId]?.error) setNotice(String(e));
      return;
    } finally { setPending(false); }
    await refreshAntigravity(instanceId, true).catch(() => {});
  };
  const forkOpening = instance?.config.fork?.openingMessage;
  useEffect(() => {
    if (terminal || !usable || busy || pending || !forkOpening) return;
    const opening = takeForkOpeningMessage(instanceId);
    if (opening) void submit(opening);
  }, [terminal, usable, busy, pending, forkOpening, instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const restart = async () => {
    setPending(true); setReady(false); setNotice('');
    try { await restartAntigravity(instanceId); setRestartKey(k => k + 1); setReady(true); }
    catch { /* shown from the session store */ }
    finally { setPending(false); }
  };
  const apply = async (change: Partial<AntigravityOptions>) => {
    setNotice('');
    try {
      await reconfigureAntigravity(instanceId, change);
      if (terminal) await restart();
    } catch (e) { setNotice(String(e)); }
  };
  const startNew = async () => {
    setPending(true); setNotice('');
    try { await newAntigravityConversation(instanceId); if (terminal) await restart(); }
    catch (e) { setNotice(String(e)); }
    finally { setPending(false); }
  };
  const signIn = async () => {
    if (!instance?.config.antigravity) return;
    setNotice('');
    try { await openAntigravitySession(instance.config.antigravity, instance.config.cwd, 'terminal'); }
    catch (e) { setNotice(String(e)); }
  };
  if (!instance) return null;
  const status = antigravityStatus(session, terminalExited);
  const lastQuestion = session?.items.filter(i => i.type === 'user').at(-1)?.text;
  const permission = instance.config.antigravity?.permission ?? 'review';
  return <section className="terminal-panel codex-panel opencode-panel antigravity-panel" style={{ borderTopColor: instance.color }}>
    <AgentPanelHeader instanceId={instanceId} metadata={`Antigravity · ${antigravityModelLabel(session?.model || instance.config.model)} · ${ANTIGRAVITY_PERMISSIONS[permission].label}`}
      status={status.label} statusColor={status.color}
      onClose={() => void closePanel(instanceId)} onFork={terminal ? undefined : () => void startFork(instanceId)}
      onRestart={!busy && !pending ? () => void restart() : undefined} restarting={pending && !ready}
      onStop={busy && !terminal ? () => void invoke('antigravity_interrupt', { id: instanceId }).then(() => refreshAntigravity(instanceId, true)).catch(e => setNotice(String(e))) : undefined}
      controls={<Controls instanceId={instanceId} session={session} terminal={!!terminal} apply={change => void apply(change)} />}
    />
    {session?.error && <div role="alert" className="codex-error antigravity-error-banner">{session.error}
      <div className="codex-recovery-actions">
        {session.recovery === 'new_conversation' && <button className="btn btn-primary" disabled={pending} onClick={() => void startNew()}>Start a new conversation here</button>}
        {session.recovery === 'login' && !terminal && <button className="btn btn-primary" disabled={pending} onClick={() => void signIn()}>Open sign-in terminal</button>}
        {session.recovery !== 'new_conversation' && !terminal && !!lastQuestion && usable && <button className="btn btn-secondary" disabled={pending || busy} onClick={() => void submit(lastQuestion)}>Send the last message again</button>}
        {session.recovery !== 'new_conversation' && <button className="btn btn-secondary" disabled={pending} onClick={() => void restart()}>{terminal ? 'Restart terminal' : session.configured ? 'Reconnect' : 'Retry'}</button>}
      </div>
      {session.recovery === 'executable' && <p>Install the Antigravity CLI or choose agy.exe under Settings → Antigravity, then retry.</p>}
    </div>}
    {notice && <p role="status" className="codex-error">{notice}</p>}
    {terminalExited && !session?.error && <div className="codex-error">The terminal exited. Its Antigravity conversation is kept and resumes by ID. <button className="btn btn-secondary" disabled={pending} onClick={() => void restart()}>Reopen terminal</button></div>}
    {terminal ? <div className="codex-terminal">{usable ? <XTermView key={restartKey} instanceId={instanceId} isVisible /> : <p className="codex-empty">{session?.error ? 'Resolve the problem above to open the terminal.' : 'Starting the Antigravity terminal…'}</p>}</div> : <>
      <div className="codex-transcript" ref={body} onScroll={() => { const el = body.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
        {instance.config.fork?.pending && <ForkNotice instanceId={instanceId} />}
        {session?.items.map(item => <AntigravityItemView key={item.id} item={item} />)}
        {!session?.items.length && <p className="codex-empty">{usable ? 'Ask Antigravity to work in this project.' : session?.error ? 'Antigravity is not available yet.' : 'Connecting to Antigravity…'}</p>}
        {busy && <p className="opencode-hint antigravity-working" role="status">Antigravity is working… Quiet periods are normal while it thinks or runs tools.</p>}
      </div>
      <footer className="chat-input-area codex-input"><div className="chat-input-row">
        <textarea className="chat-textarea" rows={2} aria-label="Message Antigravity" placeholder="Message Antigravity… (Enter to send, Shift+Enter for a new line)" value={text} disabled={!usable} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(text, true); } }} />
        <button className="btn btn-primary" disabled={!usable || pending || busy || !text.trim()} onClick={() => void submit(text, true)}>Send</button>
      </div>
      <p className="opencode-hint antigravity-usage">{session?.usage ? `Conversation: ${formatAntigravityUsage(session.usage)} · reported by agy` : 'Conversation token usage: not reported yet'}</p>
      </footer>
    </>}
  </section>;
}
