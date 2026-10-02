import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Activity, ArrowDown, ArrowRight, Check, Download, Focus, GitBranch, List, Maximize2, MessageSquare, RefreshCw, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ActivityActor, ActivityPage, ActivityRecord } from '../../types/activity';
import { activityGraph, activitySummary, actorKey, byTime, mergeActivity, providerName, shortTokens, tokenTotal } from '../../lib/activityGraph';
import { useInstanceStore } from '../../store/instanceStore';
import { focusShortcutPanel } from '../../lib/panelShortcuts';
import '../../styles/activity.css';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const date = (at: number) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
const preview = (text: string, length = 68) => text.replace(/\s+/g, ' ').slice(0, length) + (text.length > length ? '…' : '');
function Badge({ actor }: { actor: ActivityActor }) {
  return <span className={`activity-provider activity-provider--${actor.provider}`}><i />{providerName(actor.provider)}</span>;
}
function UsageBar({ record }: { record: ActivityRecord }) {
  if (!record.usage) return <span className="activity-unavailable">Usage unavailable</span>;
  const usage = record.usage;
  const total = tokenTotal(usage);
  return <div className="activity-usage"><span>{shortTokens(total)} <small>tokens</small></span><div className="activity-token-bar" aria-label={`${total.toLocaleString()} reported tokens`}>
    {(['input', 'cacheRead', 'cacheWrite', 'output'] as const).map(key => <i key={key} className={`activity-token--${key}`} style={{ width: `${total ? usage[key] / total * 100 : 0}%` }} />)}
  </div></div>;
}

export default function ActivityView() {
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [mode, setMode] = useState<'flow' | 'timeline'>('flow');
  const [days, setDays] = useState('7');
  const [provider, setProvider] = useState('all');
  const [chat, setChat] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<ActivityPage['health']>({ error: null, lastScan: 0 });
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const generation = useRef(0);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const rangeStart = useMemo(() => days === 'all' ? null : Date.now() - Number(days) * 86400000, [days]);
  useEffect(() => {
    const version = ++generation.current;
    let alive = true;
    let busy = false;
    let first = true;
    setLoading(true); setRecords([]); setSelected(null);
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const refreshIds = first ? [] : recordsRef.current.filter(r => ['running', 'recorded', 'sending', 'queued'].includes(r.status)).map(r => r.id);
        const page = await invoke<ActivityPage>('activity_list', { since: rangeStart, limit: 300, refreshIds });
        if (!alive || version !== generation.current) return;
        setRecords(old => mergeActivity(old, page.records));
        if (first) setHasMore(page.hasMore);
        setHealth(page.health); setError(null); first = false;
      } catch (err) { if (alive) setError(String(err)); }
      finally { busy = false; if (alive) setLoading(false); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => { alive = false; clearInterval(timer); };
  }, [rangeStart, reload]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setExpanded(false); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [expanded]);

  const actors = useMemo(() => {
    const map = new Map<string, ActivityActor>();
    records.forEach(r => { map.set(actorKey(r.actor), r.actor); if (r.target) map.set(actorKey(r.target), r.target); });
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [records]);
  const filtered = useMemo(() => records.filter(r => {
    if (provider !== 'all' && r.actor.provider !== provider && r.target?.provider !== provider) return false;
    if (chat !== 'all' && actorKey(r.actor) !== chat && (!r.target || actorKey(r.target) !== chat)) return false;
    const q = search.trim().toLowerCase();
    return !q || [r.actor.name, r.actor.model, r.target?.name, r.prompt, r.response].join(' ').toLowerCase().includes(q);
  }), [records, provider, chat, search]);
  const summary = useMemo(() => activitySummary(filtered), [filtered]);
  const selectedRecord = records.find(r => r.id === selected);
  const loadOlder = async () => {
    if (loading || !records.length) return;
    const version = generation.current;
    const oldest = records[0]; setLoading(true);
    try {
      const page = await invoke<ActivityPage>('activity_list', { since: rangeStart, before: { at: oldest.startedAt, id: oldest.id }, limit: 300 });
      if (version !== generation.current) return;
      setRecords(old => mergeActivity(old, page.records)); setHasMore(page.hasMore); setError(null);
    } catch (err) { if (version === generation.current) setError(String(err)); }
    finally { if (version === generation.current) setLoading(false); }
  };
  const exportRecords = async () => {
    setExporting(true);
    try {
      const path = await save({ defaultPath: `tessera-activity-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Activity JSON', extensions: ['json'] }] });
      if (path) await writeTextFile(path, JSON.stringify({ exportedAt: new Date().toISOString(), scope: 'Loaded, filtered records; usage totals exclude handoffs', records: filtered }, null, 2));
    } catch (err) { setError(String(err)); }
    finally { setExporting(false); }
  };
  const view = <section className={`activity-view${expanded ? ' activity-view--expanded' : ''}`} aria-label="Activity history" {...(expanded ? { role: 'dialog', 'aria-modal': true } : {})}>
    <header className="activity-heading"><div className="activity-heading-icon"><Activity size={19} /></div><div><h2>Activity</h2><p>Conversations, connections & tokens</p></div>
      <span className={`activity-live${health.error || error ? ' activity-live--error' : ''}`}><i />{health.error || error ? 'Check recorder' : health.lastScan ? 'Recording locally' : 'Connecting'}</span>
      <button className="activity-icon-button" title={expanded ? 'Exit expanded view' : 'Expand activity'} aria-label={expanded ? 'Exit expanded view' : 'Expand activity'} onClick={() => setExpanded(v => !v)}>{expanded ? <X size={16} /> : <Maximize2 size={16} />}</button>
    </header>
    <div className="activity-controls"><div className="activity-switch" role="group" aria-label="Activity view">
      <button aria-pressed={mode === 'flow'} onClick={() => setMode('flow')}><GitBranch size={14} />Flow</button>
      <button aria-pressed={mode === 'timeline'} onClick={() => setMode('timeline')}><List size={14} />Timeline</button>
    </div><select aria-label="Activity date range" value={days} onChange={e => setDays(e.target.value)}><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All recorded history</option></select>
      <button className="activity-icon-button" aria-label="Refresh activity" title="Refresh activity" onClick={() => setReload(v => v + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
      <button className="activity-icon-button" aria-label="Export visible activity" title="Export loaded, filtered records" disabled={exporting || !filtered.length} onClick={() => void exportRecords()}><Download size={14} /></button>
    </div>
    <div className="activity-stats"><div><span>Reported tokens</span><strong>{shortTokens(summary.total)}</strong><small>{summary.missing ? `${summary.missing} ${summary.missing === 1 ? 'turn has' : 'turns have'} unavailable usage` : 'Input + cache + output'}</small></div><div><span>Questions / turns</span><strong>{summary.turns}</strong><small>Across named chats</small></div><div><span>Agent handoffs</span><strong>{summary.handoffs}</strong><small>Linked between panels</small></div></div>
    <div className="activity-filters"><label className="activity-search"><Search size={14} /><input aria-label="Search activity" placeholder="Search messages or chats…" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <select aria-label="Filter provider" value={provider} onChange={e => setProvider(e.target.value)}><option value="all">All providers</option>{[...new Set(actors.map(([, a]) => a.provider))].map(p => <option key={p} value={p}>{providerName(p)}</option>)}</select>
      <select aria-label="Filter chat" value={chat} onChange={e => setChat(e.target.value)}><option value="all">All chats</option>{actors.map(([key, a]) => <option key={key} value={key}>{a.name} · {providerName(a.provider)}{a.device ? ` · ${a.device}` : ''} · {a.id.slice(-6)}</option>)}</select>
    </div>
    {(error || health.error) && <div className="activity-error" role="alert">{error || health.error} <button onClick={() => setReload(v => v + 1)}>Retry</button></div>}
    <div className="activity-body">
      {!filtered.length ? <div className="activity-empty"><GitBranch size={32} /><h3>{loading ? 'Loading activity…' : records.length ? 'No matching activity' : 'Your conversations will take shape here'}</h3><p>{records.length ? 'Try another chat, provider, or search.' : 'Ask a question in a Claude or Codex panel. Chat names, replies, token usage, and messages between agents are recorded here automatically.'}</p></div>
        : mode === 'flow' ? <FlowGraph records={filtered} selected={selected} onSelect={setSelected} />
          : <div className="activity-timeline">{[...filtered].sort(byTime).reverse().map(record => <button key={record.id} className={`activity-event${selected === record.id ? ' is-selected' : ''}`} onClick={() => setSelected(record.id)}>
            <div className="activity-event-time">{time(record.startedAt)}<small>{date(record.startedAt)}</small></div>
            <div className={`activity-event-dot activity-event-dot--${record.actor.provider}`}>{record.kind === 'handoff' ? <ArrowRight size={14} /> : <MessageSquare size={14} />}</div>
            <div className="activity-event-content"><div className="activity-event-title"><strong>{record.actor.name}</strong><Badge actor={record.actor} /><span className="activity-status">{record.status}</span></div>
              {record.target && <div className="activity-destination"><ArrowRight size={12} />{record.target.name}<Badge actor={record.target} /></div>}
              <p>{preview(record.prompt || 'Waiting for message details', 140)}</p><div className="activity-event-bottom">{record.kind === 'turn' ? <UsageBar record={record} /> : <span className="activity-unavailable">Message to another chat</span>}<span>View details <ArrowRight size={12} /></span></div>
            </div></button>)}</div>}
      {selectedRecord && <RecordDetails record={selectedRecord} records={records} onSelect={setSelected} onClose={() => setSelected(null)} onOpenChat={() => setExpanded(false)} />}
    </div>
    <footer className="activity-footer"><div className="activity-legend"><span><i className="activity-token--input" />Input</span><span><i className="activity-token--cacheRead" />Cache read</span><span><i className="activity-token--cacheWrite" />Cache write</span><span><i className="activity-token--output" />Output</span></div>
      <span>{filtered.length} loaded records{hasMore ? ' · more available' : ''}</span>{hasMore && <button disabled={loading} onClick={() => void loadOlder()}><ArrowDown size={12} />Load older</button>}
    </footer>
    <p className="activity-coverage">Claude & Codex panels on this PC. Existing Claude transcripts are imported when open. Codex recording starts with this build. Remote usage and internal subagents are not included; handoffs never add tokens twice.</p>
  </section>;
  return expanded ? createPortal(<div className="activity-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setExpanded(false); }}>{view}</div>, document.body) : view;
}

function FlowGraph({ records, selected, onSelect }: { records: ActivityRecord[]; selected: string | null; onSelect: (id: string) => void }) {
  // Bound the drawn graph, not stored history. Timeline/search can reach every loaded record.
  const shown = records.slice(-100);
  const graph = useMemo(() => activityGraph(shown), [records]);
  const viewport = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const marker = `arrow-${useId().replace(/:/g, '')}`;
  const [camera, setCamera] = useState({ x: 20, y: 16, scale: .85 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; pointer: number } | null>(null);
  const fitted = useRef(false);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const fit = useCallback(() => {
    const scale = Math.max(.02, Math.min(1, (size.width - 48) / graph.width, (size.height - 60) / graph.height));
    setCamera({ x: Math.max(16, (size.width - graph.width * scale) / 2), y: 20, scale });
  }, [size, graph.width, graph.height]);
  useEffect(() => {
    if (!fitted.current && size.width > 0) {
      const scale = Math.max(.4, Math.min(1, (size.width - 48) / graph.width));
      setCamera({ x: 24, y: 20, scale }); fitted.current = true;
    }
  }, [graph.width, size]);
  const zoom = (factor: number) => setCamera(old => {
    const scale = Math.max(.02, Math.min(2, old.scale * factor));
    return { scale, x: size.width / 2 - (size.width / 2 - old.x) * scale / old.scale, y: size.height / 2 - (size.height / 2 - old.y) * scale / old.scale };
  });
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        setCamera(old => {
          const scale = Math.max(.02, Math.min(2, old.scale * (event.deltaY < 0 ? 1.08 : .92)));
          return { scale, x: size.width / 2 - (size.width / 2 - old.x) * scale / old.scale, y: size.height / 2 - (size.height / 2 - old.y) * scale / old.scale };
        });
      } else setCamera(old => ({ ...old, x: old.x - event.deltaX, y: old.y - event.deltaY }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [size]);
  const positions = new Map(graph.nodes.map(n => [n.record.id, n]));
  return <div className="activity-graph" ref={viewport}>
    <div className="activity-graph-help">Drag to pan · select a card{records.length > 100 && ' · latest 100 records shown'}</div>
    <div className="activity-graph-tools"><button aria-label="Zoom out" onClick={() => zoom(.8)}><ZoomOut size={15} /></button><span>{Math.round(camera.scale * 100)}%</span><button aria-label="Zoom in" onClick={() => zoom(1.25)}><ZoomIn size={15} /></button><button aria-label="Fit graph" title="Fit graph" onClick={fit}><Focus size={15} /></button><button aria-label="Go to latest activity" title="Go to latest" onClick={() => setCamera(old => ({ ...old, y: size.height - 40 - graph.height * old.scale }))}><ArrowDown size={15} /></button></div>
    <svg ref={svg} width="100%" height="100%" aria-label="Conversation flow graph" role="group" onPointerDown={e => {
      if ((e.target as Element).closest('[data-activity-node]')) return;
      drag.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, pointer: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => { const d = drag.current; if (d) setCamera(old => ({ ...old, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y })); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
      <g transform={`translate(${camera.x},${camera.y}) scale(${camera.scale})`}>
        <text x="25" y="30" className="activity-lane-label">You</text><line x1="40" y1="52" x2="40" y2={graph.height} className="activity-lane-line" />
        {graph.lanes.map(lane => <g key={lane.key}><line x1={lane.x + 120} y1="64" x2={lane.x + 120} y2={graph.height} className="activity-lane-line" />
          <text x={lane.x} y="28" className="activity-lane-label">{preview(lane.actor.name, 28)}<title>{lane.actor.name} · {lane.actor.id}</title></text><text x={lane.x} y="48" className={`activity-lane-provider activity-lane-provider--${lane.actor.provider}`}>{providerName(lane.actor.provider)}{lane.actor.device ? ` · ${preview(lane.actor.device, 16)}` : ''}</text></g>)}
        {graph.edges.map(edge => {
          const target = positions.get(edge.to)!; const source = edge.from ? positions.get(edge.from) : null;
          const x1 = source ? source.x + 120 : 40; const y1 = source ? source.y + 100 : target.y + 30;
          const x2 = source ? target.x + 120 : target.x; const y2 = source ? target.y : target.y + 30;
          return <path key={edge.id} d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`} markerEnd={`url(#${marker})`} className={`activity-edge activity-edge--${edge.kind}${selected === edge.to || selected === edge.from ? ' is-selected' : ''}`}><title>{edge.label}</title></path>;
        })}
        {graph.nodes.map(({ record, x, y }) => <g key={record.id} transform={`translate(${x},${y})`} data-activity-node={record.id} tabIndex={0} role="button" aria-label={`${record.actor.name} · ${providerName(record.actor.provider)} · ${record.kind === 'handoff' ? 'Send to ' + record.target?.name : record.prompt || 'Turn'}`} onClick={() => onSelect(record.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(record.id); } }} className={`activity-node activity-node--${record.actor.provider}${record.kind === 'handoff' ? ' activity-node--handoff' : ''}${selected === record.id ? ' is-selected' : ''}`}>
          <rect width="244" height="100" rx="12" /><rect className="activity-node-accent" width="4" height="60" y="20" rx="2" />
          <text x="15" y="23" className="activity-node-name">{preview(record.actor.name, 25)}</text><text x="15" y="41" className="activity-node-meta">{providerName(record.actor.provider)} · {time(record.startedAt)}</text>
          <text x="15" y="63" className="activity-node-message">{preview(record.kind === 'handoff' ? `→ ${record.target?.name ?? 'Another chat'}: ${record.prompt}` : record.prompt || 'Waiting for details', 33)}</text>
          <text x="15" y="85" className="activity-node-usage">{record.kind === 'handoff' ? record.status : record.usage ? `${shortTokens(tokenTotal(record.usage))} tokens` : 'Usage unavailable'}</text>
          <text x="228" y="85" textAnchor="end" className="activity-node-status">{record.kind === 'turn' ? record.status : 'Handoff'}</text>
        </g>)}
      </g>
    </svg>
  </div>;
}

function RecordDetails({ record, records, onSelect, onClose, onOpenChat }: { record: ActivityRecord; records: ActivityRecord[]; onSelect: (id: string) => void; onClose: () => void; onOpenChat: () => void }) {
  const instances = useInstanceStore(s => s.instances);
  const [jumpError, setJumpError] = useState('');
  useEffect(() => setJumpError(''), [record.id]);
  const parent = records.find(r => r.id === record.parentId);
  const children = records.filter(r => r.parentId === record.id);
  const usage = record.usage;
  return <aside className="activity-details" aria-label="Activity details"><header><span>{record.kind === 'handoff' ? 'AGENT HANDOFF' : 'CONVERSATION TURN'}</span><button className="activity-icon-button" onClick={onClose} aria-label="Close activity details"><X size={16} /></button></header>
    <h3>{record.actor.name}</h3><Badge actor={record.actor} />{record.actor.model && <span className="activity-detail-model">{record.actor.model}</span>}
    {record.target && <div className="activity-detail-target"><ArrowRight size={16} /><strong>{record.target.name}</strong><Badge actor={record.target} /></div>}
    <dl className="activity-metadata"><dt>Time</dt><dd>{new Date(record.startedAt).toLocaleString()}</dd><dt>Status</dt><dd>{record.status}</dd>{record.actor.device && <><dt>Computer</dt><dd>{record.actor.device}</dd></>}<dt>Chat ID</dt><dd title={record.actor.id}>{record.actor.id}</dd>{!!record.tools?.length && <><dt>Tools</dt><dd>{record.tools.join(', ')}</dd></>}</dl>
    {instances.has(record.actor.id) && <button className="activity-open-chat" onClick={() => { if (!focusShortcutPanel(record.actor.id)) setJumpError('This chat is no longer open.'); else onOpenChat(); }}><MessageSquare size={13} />Open chat</button>}
    {jumpError && <p role="status">{jumpError}</p>}
    {usage ? <div className="activity-detail-usage"><UsageBar record={record} /><dl>{([['input', 'New input'], ['cacheRead', 'Cache read'], ['cacheWrite', 'Cache write'], ['output', 'Output']] as const).map(([key, label]) => <div key={key}><dt><i className={`activity-token--${key}`} />{label}</dt><dd>{usage[key].toLocaleString()}</dd></div>)}</dl>{usage.reasoning > 0 && <p>{usage.reasoning.toLocaleString()} reasoning tokens included in output.</p>}</div> : record.kind === 'turn' && <p className="activity-detail-note">Token usage has not been reported for this turn.</p>}
    {record.usageNote && <p className="activity-detail-note">{record.usageNote}</p>}
    {parent ? <button className="activity-linked" onClick={() => onSelect(parent.id)}><GitBranch size={14} /><span>From {parent.actor.name} · {providerName(parent.actor.provider)}</span><ArrowRight size={14} /></button> : record.parentId ? <p className="activity-detail-note">Related activity is outside the loaded range.</p> : record.kind === 'turn' && record.origin === 'panel' ? <p className="activity-detail-note">Message from another panel; no recorded link is available.</p> : null}
    <h4>{record.kind === 'handoff' ? 'Message sent' : record.origin === 'panel' ? 'Incoming message' : 'Your message'}</h4>
    {(record.promptParts?.length ?? 0) > 1 ? record.promptParts!.map(part => <div key={part.id}><p className="activity-detail-note">{time(part.at)}</p><div className="activity-message">{part.text}</div></div>) : <div className="activity-message">{record.prompt || 'Message details unavailable.'}</div>}
    {record.response && <><h4>{record.kind === 'handoff' ? 'Delivery error' : 'Response'}</h4><div className="activity-message">{record.response}</div></>}
    {children.length > 0 && <><h4>Connected activity</h4>{children.map(child => <button key={child.id} className="activity-linked" onClick={() => onSelect(child.id)}><Check size={13} /><span>{child.actor.name} · {providerName(child.actor.provider)}</span><ArrowRight size={14} /></button>)}</>}
  </aside>;
}
