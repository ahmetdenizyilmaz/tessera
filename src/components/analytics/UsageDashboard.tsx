import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BarChart3, Download, RefreshCw } from 'lucide-react';
import TokenChart from './TokenChart';
import CostBreakdown from './CostBreakdown';
import { AnalyticsSummaryCards } from './AnalyticsSummaryCards';
import { formatCost, formatTokens } from './chartTheme';
import { providerName } from '../../lib/activityGraph';
import type { PeriodRow, Tokens, UsageReport } from '../../types/usage';

type Tab = 'daily' | 'monthly' | 'sessions' | 'models' | 'projects';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'daily', label: 'Daily' }, { key: 'monthly', label: 'Monthly' }, { key: 'sessions', label: 'Sessions' },
  { key: 'models', label: 'Models' }, { key: 'projects', label: 'Projects' },
];
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const total = (t: Tokens) => t.input + t.output + t.cacheWrite + t.cacheRead;
/** "opus-5-5" instead of "claude-opus-5-5"; gateway models keep their full name. */
const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
/** Priced models first, at most three named; the rest are counted. The full list is the tooltip. */
function ModelList({ models }: { models: string[] }) {
  const ordered = [...models].sort((a, b) => Number(b.startsWith('claude-')) - Number(a.startsWith('claude-')) || a.localeCompare(b));
  const shown = ordered.slice(0, 3).map(shortModel).join(', ');
  return <span title={ordered.join(', ')}>{shown}{ordered.length > 3 ? ` +${ordered.length - 3}` : ''}</span>;
}
const money = (t: Tokens) => t.cost > 0 ? formatCost(t.cost) : t.unpriced > 0 ? '—' : '$0.00';

const cell: React.CSSProperties = { padding: '7px 10px', fontSize: 12, whiteSpace: 'nowrap' };
const num: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' };
const head: React.CSSProperties = { ...cell, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg-elevated)' };

function TokenCells({ t, strong }: { t: Tokens; strong?: boolean }) {
  const style = strong ? { ...num, color: 'var(--text-primary)', fontWeight: 600 } : num;
  return <>
    <td style={style}>{formatTokens(t.input)}</td>
    <td style={style}>{formatTokens(t.output)}</td>
    <td style={style}>{formatTokens(t.cacheWrite)}</td>
    <td style={style}>{formatTokens(t.cacheRead)}</td>
    <td style={style}>{formatTokens(total(t))}</td>
    <td style={{ ...style, color: strong ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 600 }} title={t.unpriced > 0 ? `${formatTokens(t.unpriced)} tokens from models without a list price are not costed` : undefined}>{money(t)}{t.unpriced > 0 && t.cost > 0 ? '*' : ''}</td>
  </>;
}
const TOKEN_HEADS = ['Input', 'Output', 'Cache create', 'Cache read', 'Total tokens', 'Cost (USD)'];

function Table({ heads, rows, totals, empty }: { heads: string[]; rows: React.ReactNode; totals?: React.ReactNode; empty: string }) {
  // flexShrink 0: inside the scrolling column a table must not collapse when the page is taller than the sidebar.
  return <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', flexShrink: 0 }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>{heads.map((h, i) => <th key={h} style={{ ...head, textAlign: i < heads.length - 6 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
      <tbody>{rows}{totals}</tbody>
    </table>
    {!rows || (Array.isArray(rows) && rows.length === 0) ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{empty}</div> : null}
  </div>;
}

function periodRows(rows: PeriodRow[], totals: Tokens, label: string) {
  const body = [...rows].reverse().map(r => <tr key={r.period} style={{ borderBottom: '1px solid var(--border)' }}>
    <td style={{ ...cell, color: 'var(--text-primary)', fontWeight: 500 }}>{r.period}</td>
    <td style={{ ...cell, color: 'var(--text-secondary)' }}><ModelList models={r.models} /></td>
    <TokenCells t={r} />
  </tr>);
  const foot = rows.length > 0 && <tr><td style={{ ...cell, fontWeight: 700, color: 'var(--text-primary)' }}>Total</td><td style={cell} /><TokenCells t={totals} strong /></tr>;
  return <Table heads={[label, 'Models', ...TOKEN_HEADS]} rows={body} totals={foot} empty="No Claude Code usage in this range." />;
}

export default function UsageDashboard() {
  const today = localDate(new Date());
  const [startDate, setStartDate] = useState(localDate(new Date(Date.now() - 30 * 86400000)));
  const [endDate, setEndDate] = useState(today);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('daily');
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    invoke<UsageReport>('usage_report', { startDate, endDate })
      .then(data => { if (active) setReport(data); })
      .catch(e => { if (active) setError(String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [startDate, endDate, generation]);
  // Session files change as agents work: refresh while the widget is open.
  useEffect(() => { const timer = setInterval(() => setGeneration(g => g + 1), 60000); return () => clearInterval(timer); }, []);


  const exportCsv = () => {
    if (!report) return;
    const rows: (string | number)[][] = [];
    const push = (label: string, extra: string[], t: Tokens, more: (string | number)[] = []) => rows.push([label, ...extra, t.input, t.output, t.cacheWrite, t.cacheRead, total(t), t.cost.toFixed(4), ...more]);
    if (tab === 'daily' || tab === 'monthly') { rows.push([tab === 'daily' ? 'date' : 'month', 'models', 'input', 'output', 'cache_create', 'cache_read', 'total_tokens', 'cost_usd']); (tab === 'daily' ? report.daily : report.monthly).forEach(r => push(r.period, [r.models.join(' ')], r)); }
    else if (tab === 'sessions') { rows.push(['provider', 'session_id', 'project', 'last_activity', 'models', 'input', 'output', 'cache_create', 'cache_read', 'total_tokens', 'cost_usd']); report.sessions.forEach(r => push(r.provider, [r.sessionId, r.project, new Date(r.lastAt).toISOString(), r.models.join(' ')], r)); }
    else if (tab === 'models') { rows.push(['provider', 'model', 'messages', 'input', 'output', 'cache_create', 'cache_read', 'total_tokens', 'cost_usd']); report.models.forEach(r => push(r.provider, [r.model, String(r.messages)], r)); }
    else { rows.push(['project', 'sessions', 'input', 'output', 'cache_create', 'cache_read', 'total_tokens', 'cost_usd']); report.projects.forEach(r => push(r.project, [String(r.sessions)], r)); }
    const csv = rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `usage_${tab}_${startDate}_${endDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const preset = (days: number | 'month' | 'all') => {
    setEndDate(today);
    setStartDate(days === 'all' ? '2020-01-01' : days === 'month' ? today.slice(0, 8) + '01' : localDate(new Date(Date.now() - days * 86400000)));
  };
  const chip: React.CSSProperties = { padding: '2px 8px', fontSize: 10 };

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><BarChart3 size={16} style={{ color: 'var(--accent)' }} /><span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Analytics</span>{loading && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Reading session files…</span>}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setGeneration(g => g + 1)} title="Re-read the session files now" style={{ ...chip, display: 'flex', alignItems: 'center', gap: 4 }}><RefreshCw size={11} /></button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!report} style={{ ...chip, display: 'flex', alignItems: 'center', gap: 4 }}><Download size={12} /> CSV</button>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {([['Today', 0], ['Last 7 days', 6], ['Last 30 days', 29], ['This month', 'month'], ['All time', 'all']] as const).map(([label, days]) => <button key={label} className="btn btn-secondary btn-sm" onClick={() => preset(days)} style={chip}>{label}</button>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="date" className="form-input" aria-label="Start date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '3px 6px' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>to</span>
        <input type="date" className="form-input" aria-label="End date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '3px 6px' }} />
      </div>
      <div style={{ display: 'flex', marginTop: 8 }}>
        {TABS.map((t, i) => <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key} style={{ flex: 1, padding: '5px 0', fontSize: 11, fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)', background: tab === t.key ? 'var(--bg-elevated)' : 'transparent', border: '1px solid var(--border)', borderBottom: tab === t.key ? '2px solid var(--accent)' : '1px solid var(--border)', cursor: 'pointer', borderRadius: i === 0 ? '4px 0 0 0' : i === TABS.length - 1 ? '0 4px 0 0' : 0 }}>{t.label}</button>)}
      </div>
    </div>

    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <p role="alert" style={{ textAlign: 'center', color: 'var(--error)', fontSize: 13 }}>{error}</p>}
      {!report && loading && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Reading Claude Code session files…</p>}
      {report && <AnalyticsSummaryCards totalCost={report.totals.cost} totalInputTokens={report.totals.input} totalOutputTokens={report.totals.output} sessionsCount={report.sessions.length} />}
      {report && tab === 'daily' && <>
        {report.daily.length > 1 && <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Tokens per day</h3>
          <TokenChart data={report.daily.map(d => ({ date: d.period, input_tokens: d.input + d.cacheWrite + d.cacheRead, output_tokens: d.output, cost_usd: d.cost }))} />
        </div>}
        {periodRows(report.daily, report.totals, 'Date')}
      </>}
      {report && tab === 'monthly' && periodRows(report.monthly, report.totals, 'Month')}
      {report && tab === 'sessions' && <Table heads={['Session', 'Models', ...TOKEN_HEADS]} empty="No Claude Code sessions in this range."
        rows={report.sessions.map(s => <tr key={`${s.provider}:${s.sessionId}`} style={{ borderBottom: '1px solid var(--border)' }}>
          <td style={{ ...cell, whiteSpace: 'normal' }}><div style={{ color: 'var(--text-primary)', fontWeight: 500 }} title={s.sessionId}>{s.project.split(/[\\/]/).pop() || s.project} · {s.sessionId.slice(0, 8)}</div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{providerName(s.provider)} · {new Date(s.lastAt).toLocaleString()} · {s.messages} messages</div></td>
          <td style={{ ...cell, color: 'var(--text-secondary)' }}><ModelList models={s.models} /></td>
          <TokenCells t={s} />
        </tr>)}
        totals={report.sessions.length > 0 && <tr><td style={{ ...cell, fontWeight: 700, color: 'var(--text-primary)' }}>Total · {report.sessions.length} sessions</td><td style={cell} /><TokenCells t={report.totals} strong /></tr>} />}
      {report && tab === 'models' && <>
        <Table heads={['Agent', 'Sessions', 'Messages', ...TOKEN_HEADS]} empty="No usage in this range."
          rows={report.providers.map(p => <tr key={p.provider} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ ...cell, color: 'var(--text-primary)', fontWeight: 500 }}>{providerName(p.provider)}</td>
            <td style={num}>{p.sessions}</td><td style={num}>{p.messages}</td><TokenCells t={p} />
          </tr>)}
          totals={report.providers.length > 1 && <tr><td style={{ ...cell, fontWeight: 700, color: 'var(--text-primary)' }}>Total</td><td style={num}>{report.sessions.length}</td><td style={num}>{report.messages}</td><TokenCells t={report.totals} strong /></tr>} />
        {report.models.some(m => m.cost > 0) && <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Cost by model</h3>
          <CostBreakdown data={report.models.filter(m => m.cost > 0).map(m => ({ model: shortModel(m.model), cost_usd: m.cost }))} />
        </div>}
        <Table heads={['Model', 'Messages', ...TOKEN_HEADS]} empty="No model usage in this range."
          rows={report.models.map(m => <tr key={`${m.provider}:${m.model}`} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ ...cell, color: 'var(--text-primary)', fontWeight: 500 }}>{m.model || '(model not reported)'}<span style={{ fontSize: 10, color: 'var(--text-muted)' }}> · {providerName(m.provider)}{!m.priced ? ' · no list price' : ''}</span></td>
            <td style={num}>{m.messages}</td><TokenCells t={m} />
          </tr>)}
          totals={report.models.length > 0 && <tr><td style={{ ...cell, fontWeight: 700, color: 'var(--text-primary)' }}>Total</td><td style={num}>{report.messages}</td><TokenCells t={report.totals} strong /></tr>} />
      </>}
      {report && tab === 'projects' && <Table heads={['Project', 'Sessions', ...TOKEN_HEADS]} empty="No projects in this range."
        rows={report.projects.map(p => <tr key={p.project} style={{ borderBottom: '1px solid var(--border)' }}>
          <td style={{ ...cell, whiteSpace: 'normal', color: 'var(--text-primary)', fontWeight: 500 }} title={p.project}>{p.project}</td>
          <td style={num}>{p.sessions}</td><TokenCells t={p} />
        </tr>)}
        totals={report.projects.length > 0 && <tr><td style={{ ...cell, fontWeight: 700, color: 'var(--text-primary)' }}>Total</td><td style={num}>{report.sessions.length}</td><TokenCells t={report.totals} strong /></tr>} />}
      {report && <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
        Claude Code and Codex are read from their own session files ({report.files} files, days in {report.timezone}), de-duplicated per response like <code>ccusage</code>; Antigravity from the turns Tessera recorded (chat panels, since recording began). Costs are what the tokens would cost at Anthropic's list prices; subscriptions are not billed per token. Codex, Antigravity, gateway and local models have no list price here and count as tokens only{report.totals.unpriced > 0 ? ` (${formatTokens(report.totals.unpriced)} tokens)` : ''}.
      </p>}
    </div>
  </div>;
}
