import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { ProviderIcon } from '../icons/ProviderIcons';
import { stripForkPreamble } from '../../lib/forkTranscript';
import { formatAntigravityUsage } from '../../lib/antigravityConfig';
import type { AntigravityItem } from '../../types/antigravity';

const TOOL_STATES: Record<string, string> = { active: 'running', done: 'done', error: 'failed', interrupted: 'stopped' };
const TURN_LABELS: Record<string, string> = { completed: 'Turn complete', failed: 'Turn failed', interrupted: 'Turn stopped' };

export function AntigravityItemView({ item }: { item: AntigravityItem }) {
  if (item.type === 'user') return <article className="msg msg--user codex-message-user">
    <div className="msg-header msg-header--user"><span className="msg-label">You</span></div>
    <div className="msg-body msg-body--user"><p className="msg-user-text">{stripForkPreamble(item.text ?? '')}</p></div>
  </article>;
  if (item.type === 'assistant') return <article className="msg msg--assistant codex-message">
    <div className="msg-header"><ProviderIcon provider="antigravity" size={14} /><span className="msg-label">Antigravity</span></div>
    <div className="msg-body">
      <MarkdownRenderer content={item.text ?? ''} />
      {item.state === 'interrupted' && <p className="opencode-hint">This response was cut off before it finished.</p>}
    </div>
  </article>;
  if (item.type === 'tool') return <details className="codex-tool antigravity-tool" open={item.state === 'active' || item.state === 'error'}>
    <summary>{item.name} · {TOOL_STATES[item.state ?? ''] ?? item.state}{item.durationSeconds != null && item.state !== 'active' ? ` · ${item.durationSeconds.toFixed(1)}s` : ''}</summary>
    {item.parameters != null && <pre>{JSON.stringify(item.parameters, null, 2)}</pre>}
    {item.output && <pre>{item.output}</pre>}
    {item.error && <p className="antigravity-tool-error">{item.error}</p>}
  </details>;
  if (item.type === 'notice') {
    if (item.level === 'denied') return <div className="codex-error antigravity-denied" role="note">
      <strong>Denied by Antigravity{item.text ? `: ${item.text}` : ''}</strong>
      {item.error && <pre>{item.error}</pre>}
      <p>Chat runs agy's headless mode, which cannot show an approval prompt, so the action was refused and the turn continued without it. To allow it: add a rule under <code>permissions.allow</code> in <code>~/.gemini/antigravity-cli/settings.json</code>, choose a broader permission mode in this panel's menu, or use an Antigravity terminal panel to approve interactively.</p>
    </div>;
    if (item.level === 'error') return <p className="codex-error" role="note">{item.text}</p>;
    return <p className="opencode-hint antigravity-notice" role="status">{item.text}</p>;
  }
  if (item.type === 'result') return <p className={`antigravity-turn antigravity-turn--${item.level}`} title={`agy status: ${item.text}`}>
    {TURN_LABELS[item.level ?? ''] ?? item.level}{item.durationSeconds != null ? ` · ${item.durationSeconds.toFixed(1)}s` : ''} · {item.usage ? formatAntigravityUsage(item.usage) : 'token usage not reported'}
  </p>;
  return null;
}
