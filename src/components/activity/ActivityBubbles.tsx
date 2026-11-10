import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Focus, Pause, Play, Radio, RotateCcw, Settings2, SkipBack, SkipForward, UserRound, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ActivityActor, ActivityRecord } from '../../types/activity';
import { ACTIVITY_GRAPH_LIMIT, actorKey, byTime, providerName, shortTokens } from '../../lib/activityGraph';
import { bubbleFrame, bubblePosition, bubbleRoute, DEFAULT_REPLAY, USER_BUBBLE, type ReplaySettings } from '../../lib/activityReplay';
import { useActivityReplay } from '../../hooks/useActivityReplay';
import { ProviderIcon } from '../icons/ProviderIcons';
import '../../styles/activityBubbles.css';

type Point = { x: number; y: number };
type Bubble = Point & { key: string; actor: ActivityActor | null };
type Camera = Point & { scale: number };
const color = (provider?: string) => ({ claude: '#dba47e', codex: '#70c7aa', antigravity: '#8badff', opencode: '#c0a0ed', openrouter: '#c0a0ed' }[provider ?? ''] ?? '#a9b4c8');
const shorten = (text: string, count: number) => text.length > count ? text.slice(0, count - 1) + '…' : text;
const timestamp = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function edgePath(from: Bubble, to: Bubble) {
  if (from.key === to.key) return { path: `M${from.x + 50},${from.y - 50} C${from.x + 170},${from.y - 165} ${from.x + 170},${from.y + 165} ${from.x + 55},${from.y + 55}`, x: from.x + 140, y: from.y };
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length;
  const radius = from.actor ? 78 : 58;
  const bend = 27;
  return { path: `M${from.x + ux * radius},${from.y + uy * radius} Q${(from.x + to.x) / 2 - uy * bend},${(from.y + to.y) / 2 + ux * bend} ${to.x - ux * 80},${to.y - uy * 80}`,
    x: (from.x + to.x) / 2 - uy * bend / 2, y: (from.y + to.y) / 2 + ux * bend / 2 };
}

export function ActivityBubbles({ records, selected, onSelect }: { records: ActivityRecord[]; selected: string | null; onSelect: (id: string) => void }) {
  const ordered = useMemo(() => [...records].sort(byTime), [records]);
  const replay = useActivityReplay(ordered);
  const { active, settings } = replay;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [follow, setFollow] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const cameraRef = useRef(camera);
  const cameraLayer = useRef<SVGGElement>(null);
  const animation = useRef(0);
  const fitted = useRef(false);
  const lastFit = useRef('');
  const drag = useRef<{ pointer: number; x: number; y: number; camera: Camera } | null>(null);
  const slots = useRef(new Map<string, number>());
  const arrow = 'bubble-arrow-' + useId().replace(/:/g, '');
  const nodes = useMemo(() => {
    const actors = new Map<string, ActivityActor>();
    for (const record of ordered) {
      actors.set(actorKey(record.actor), record.actor);
      if (record.target) actors.set(actorKey(record.target), record.target);
    }
    const result: Bubble[] = [];
    if (ordered.some(r => r.kind === 'turn' && r.origin === 'user')) result.push({ key: USER_BUBBLE, actor: null, x: 0, y: 0 });
    for (const [key, actor] of actors) {
      if (!slots.current.has(key)) slots.current.set(key, slots.current.size);
      result.push({ key, actor, ...bubblePosition(slots.current.get(key)!) });
    }
    return result;
  }, [ordered]);
  const positions = useMemo(() => new Map(nodes.map(n => [n.key, n])), [nodes]);
  const layoutKey = JSON.stringify([nodes.map(n => n.key), size.width, size.height]);
  const frame = useMemo(() => bubbleFrame(ordered, replay.through, settings.trail), [ordered, replay.through, settings.trail]);
  const recentByActor = useMemo(() => {
    const recent = new Map<string, ActivityRecord>();
    for (const record of ordered.slice(0, replay.through + 1)) {
      recent.set(actorKey(record.actor), record);
      if (record.target) recent.set(actorKey(record.target), record);
    }
    return recent;
  }, [ordered, replay.through]);
  const route = active && bubbleRoute(active);
  const activeKey = active && actorKey(active.actor);
  const activeTarget = active?.target && actorKey(active.target);
  const selectedRecord = ordered.find(r => r.id === selected);
  const activeEdge = route && JSON.stringify([route.from, route.to]);
  const focusKeys = active?.kind === 'handoff' && route ? [route.from, route.to] : activeKey ? [activeKey] : [];
  const focusKey = focusKeys.join('|');

  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => () => cancelAnimationFrame(animation.current), []);
  const applyCamera = useCallback((next: Camera, render = true) => {
    cameraRef.current = next;
    cameraLayer.current?.setAttribute('transform', `translate(${next.x},${next.y}) scale(${next.scale})`);
    if (render) setCamera(next);
  }, []);
  const moveCamera = useCallback((target: Camera) => {
    cancelAnimationFrame(animation.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { applyCamera(target); return; }
    const from = cameraRef.current, start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 650), eased = 1 - (1 - progress) ** 3;
      // Move only the SVG layer during easing, instead of rendering hundreds
      // of labels and edges on every animation frame.
      applyCamera({ x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased, scale: from.scale + (target.scale - from.scale) * eased }, progress === 1);
      if (progress < 1) animation.current = requestAnimationFrame(tick);
    };
    animation.current = requestAnimationFrame(tick);
  }, [applyCamera]);
  const cameraFor = useCallback((points: Bubble[], focused = false): Camera => {
    if (!points.length) return { x: size.width / 2, y: size.height / 2, scale: 1 };
    const minX = Math.min(...points.map(n => n.x)), maxX = Math.max(...points.map(n => n.x));
    const minY = Math.min(...points.map(n => n.y)), maxY = Math.max(...points.map(n => n.y));
    const scale = Math.max(.04, Math.min(focused ? 1.2 : 1, (size.width - 60) / (maxX - minX + 195), (size.height - 125) / (maxY - minY + 195)));
    return { scale, x: size.width / 2 - (minX + maxX) / 2 * scale, y: (size.height - 75) / 2 - (minY + maxY) / 2 * scale };
  }, [size]);
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    if (follow) moveCamera(cameraFor(focusKeys.map(key => positions.get(key)).filter((n): n is Bubble => !!n), true));
    else if (!fitted.current) { applyCamera(cameraFor(nodes)); fitted.current = true; }
    else if (lastFit.current !== layoutKey) moveCamera(cameraFor(nodes));
    lastFit.current = layoutKey;
  }, [follow, focusKey, layoutKey, size, cameraFor, moveCamera, applyCamera]);
  const fit = () => { setFollow(false); moveCamera(cameraFor(nodes)); };
  const zoom = useCallback((factor: number) => {
    cancelAnimationFrame(animation.current); setFollow(false);
    const old = cameraRef.current, scale = Math.max(.04, Math.min(2.5, old.scale * factor));
    applyCamera({ scale, x: size.width / 2 - (size.width / 2 - old.x) * scale / old.scale, y: size.height / 2 - (size.height / 2 - old.y) * scale / old.scale });
  }, [size, applyCamera]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const wheel = (event: WheelEvent) => { if ((event.target as Element).closest('button')) return; event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom]);
  useEffect(() => {
    if (!optionsOpen) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOptionsOpen(false); } };
    const outside = (event: PointerEvent) => { if (!options.current?.contains(event.target as Node)) setOptionsOpen(false); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside); };
  }, [optionsOpen]);
  const inspect = (record: ActivityRecord) => {
    replay.seek(ordered.findIndex(r => r.id === record.id)); setFollow(false); onSelect(record.id);
  };
  const activeSourceName = active?.kind === 'handoff' ? active.actor.name : active?.origin === 'user' ? 'You' : 'Incoming activity';
  const activeDestination = active?.target ?? active?.actor;

  return <div className="activity-bubbles" aria-label="Bubble activity view">
    <div className="activity-bubble-canvas" ref={viewport} data-following={follow ? activeKey : undefined}>
      <div className="activity-bubble-status"><span className={replay.live ? 'is-live' : ''}><i />{replay.live ? 'Live' : replay.playing ? 'Replaying' : 'History'}</span><small>{nodes.filter(n => n.actor).length} chats · {frame.visible.length} / {ACTIVITY_GRAPH_LIMIT} events</small></div>
      <div className="activity-graph-tools"><button aria-label="Zoom out bubbles" onClick={() => zoom(.8)}><ZoomOut size={15} /></button><button aria-label="Zoom in bubbles" onClick={() => zoom(1.25)}><ZoomIn size={15} /></button><button aria-label="Fit bubbles" title="Fit all chats" onClick={fit}><Focus size={15} /></button></div>
      <svg width="100%" height="100%" role="group" aria-label="Chat bubble activity map" onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('[data-activity-bubble], [data-bubble-link]')) return;
        cancelAnimationFrame(animation.current); setFollow(false);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, camera: cameraRef.current }; event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const d = drag.current; if (d?.pointer === event.pointerId) applyCamera({ ...d.camera, x: d.camera.x + event.clientX - d.x, y: d.camera.y + event.clientY - d.y });
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        <defs><marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="context-stroke" /></marker></defs>
        <g ref={cameraLayer} data-bubble-camera transform={`translate(${cameraRef.current.x},${cameraRef.current.y}) scale(${cameraRef.current.scale})`}>
          {frame.links.map(link => {
            const from = positions.get(link.from), to = positions.get(link.to); if (!from || !to) return null;
            const edge = edgePath(from, to), label = `${from.actor?.name ?? 'You'} → ${to.actor?.name}: ${link.count} ${link.kind === 'user' ? 'questions' : 'messages'}`;
            return <g key={link.key} data-bubble-link={link.key} role="button" tabIndex={0} aria-label={label} className={`activity-bubble-link${activeEdge === link.key ? ' is-active' : ''}${link.kind === 'user' ? ' is-user' : ''}`}
              onClick={() => inspect(link.latest)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(link.latest); } }}>
              <title>{label}</title><path className="activity-bubble-link-hit" d={edge.path} /><path className="activity-bubble-link-line" d={edge.path} markerEnd={`url(#${arrow})`} />
              <g transform={`translate(${edge.x},${edge.y})`}><rect x="-16" y="-11" width="32" height="22" rx="11" /><text textAnchor="middle" y="4">{link.count}</text></g>
            </g>;
          })}
          {nodes.map(node => {
            const total = frame.totals.get(node.key), isActive = node.key === activeKey || node.key === activeTarget;
            const isSelected = selectedRecord && (actorKey(selectedRecord.actor) === node.key || (selectedRecord.target && actorKey(selectedRecord.target) === node.key));
            const recent = recentByActor.get(node.key);
            const choose = () => { if (recent) inspect(recent); };
            return <g key={node.key} transform={`translate(${node.x},${node.y})`} data-activity-bubble={node.key} data-active={isActive ? '' : undefined}
              role={node.actor ? 'button' : undefined} tabIndex={node.actor ? 0 : undefined} aria-label={node.actor ? `${node.actor.name} · ${providerName(node.actor.provider)} · ${total?.turns ?? 0} turns` : 'You'}
              onClick={choose} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }}
              style={{ '--bubble-color': color(node.actor?.provider) } as CSSProperties}
              className={`activity-chat-bubble${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${!total && !isActive && node.actor ? ' is-quiet' : ''}`}>
              <title>{node.actor ? `${node.actor.name} · ${providerName(node.actor.provider)}\n${node.actor.model ?? ''}\n${node.actor.id}` : 'Your questions to agents'}</title>
              <circle className="activity-bubble-halo" r={node.actor ? 82 : 60} /><circle className="activity-bubble-disc" r={node.actor ? 72 : 50} />
              <g transform="translate(-13,-40)">{node.actor ? <ProviderIcon provider={node.actor.provider === 'codex' ? 'openai' : node.actor.provider} size={26} /> : <UserRound size={26} />}</g>
              <text textAnchor="middle" y="3" className="activity-bubble-name">{node.actor ? shorten(node.actor.name, 21) : 'You'}</text>
              <text textAnchor="middle" y="23" className="activity-bubble-provider">{node.actor ? providerName(node.actor.provider) : 'Questions'}</text>
              {node.actor && <><text textAnchor="middle" y="45" className="activity-bubble-tokens">{total ? total.missing === total.turns ? 'Usage unavailable' : `${shortTokens(total.tokens)} tokens${total.missing ? ' *' : ''}` : 'No turns here yet'}</text>
                <text textAnchor="middle" y="100" className="activity-bubble-count">{total?.turns ?? 0} turns{node.actor.device ? ` · ${shorten(node.actor.device, 18)}` : ''}</text></>}
            </g>;
          })}
        </g>
      </svg>
      {active && <button className="activity-bubble-spotlight" data-active-record={active.id} onClick={() => inspect(active)} title="View this activity's message and response">
        <div><span>{activeSourceName}</span><ArrowRight size={13} /><strong>{activeDestination?.name}</strong><small>{providerName(activeDestination?.provider ?? '')}</small></div>
        <p>{shorten((active.prompt || active.response || 'Waiting for message details').replace(/\s+/g, ' '), 180)}</p>
        <footer>{timestamp(replay.live ? Math.max(active.updatedAt, active.startedAt) : active.startedAt)}<span>{active.status} · Details <ArrowRight size={11} /></span></footer>
      </button>}
    </div>
    <div className="activity-replay-controls">
      <div className="activity-replay-buttons">
        <button aria-label="Restart replay" title="Replay from the beginning" onClick={() => replay.seek(0)}><RotateCcw size={15} /></button>
        <button aria-label="Previous activity" disabled={!ordered.length || replay.index === 0} onClick={() => replay.seek(replay.index - 1)}><SkipBack size={15} /></button>
        <button className="activity-replay-play" aria-label={replay.playing ? 'Pause replay' : 'Play replay'} disabled={!ordered.length} onClick={replay.playPause}>{replay.playing ? <Pause size={17} /> : <Play size={17} />}</button>
        <button aria-label="Next activity" disabled={replay.index >= ordered.length - 1} onClick={() => replay.seek(replay.index + 1)}><SkipForward size={15} /></button>
        <span className="activity-replay-position">{replay.live ? ordered.length : replay.index + 1} / {ordered.length}</span>
        <button className="activity-replay-text" aria-pressed={follow} title="Smoothly follow the active chat; dragging pauses camera following" onClick={() => setFollow(v => !v)}><Focus size={14} />Focus mode</button>
        <button className="activity-replay-text" aria-pressed={replay.live} onClick={() => { if (replay.live) replay.pause(); else { replay.goLive(); setFollow(true); } }}><Radio size={14} />Live Follow</button>
        <div className="activity-replay-options-anchor" ref={options}>
          <button aria-label="Replay settings" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(v => !v)}><Settings2 size={16} /></button>
          {optionsOpen && <div className="activity-replay-options" role="dialog" aria-label="Replay settings" data-browser-overlay style={{ maxHeight: Math.max(160, size.height - 8) }}>
            <header><strong>Replay settings</strong><button aria-label="Close replay settings" onClick={() => setOptionsOpen(false)}><X size={15} /></button></header>
            <label>Playback pace<select aria-label="Playback pace" value={settings.pace} onChange={e => replay.configure({ pace: e.target.value as ReplaySettings['pace'] })}><option value="time">Recorded time</option><option value="events">Activity by activity</option></select></label>
            <div className="activity-replay-rate"><label>{settings.pace === 'time' ? 'Time per second' : 'Activities per second'}<input aria-label="Replay rate" type="number" min="0.1" max="100" step="0.1" value={settings.amount} onChange={e => replay.configure({ amount: Number(e.target.value) })} /></label>
              {settings.pace === 'time' && <label>Unit<select aria-label="Replay time unit" value={settings.unit} onChange={e => replay.configure({ unit: e.target.value as ReplaySettings['unit'] })}><option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option><option value="week">Weeks</option></select></label>}</div>
            <label>Connection trail<select aria-label="Connection trail" value={settings.trail} onChange={e => replay.configure({ trail: Number(e.target.value) })}><option value="0">Last 500 activities</option><option value="60000">Last recorded minute</option><option value="3600000">Last recorded hour</option><option value="86400000">Last recorded day</option></select></label>
            <label className="activity-replay-check"><input type="checkbox" checked={settings.skipGaps} disabled={settings.pace !== 'time'} onChange={e => replay.configure({ skipGaps: e.target.checked })} />Skip quiet gaps <small>At most 2 seconds between activities.</small></label>
            <label className="activity-replay-check"><input type="checkbox" checked={settings.loop} onChange={e => replay.configure({ loop: e.target.checked })} />Loop replay</label>
            <p>Replay covers all loaded, filtered history. Load older pages to go further. Counts and tokens use the visible event window; * marks unavailable usage.</p>
            <button className="activity-replay-reset" onClick={() => replay.configure(DEFAULT_REPLAY)}>Reset replay settings</button>
          </div>}
        </div>
      </div>
      <label className="activity-replay-scrubber"><span>{ordered[0] ? timestamp(ordered[0].startedAt) : 'Start'}</span><input type="range" aria-label="Replay position" min="0" max={Math.max(0, ordered.length - 1)} step="1" value={replay.live ? ordered.length - 1 : replay.index} onChange={e => replay.seek(Number(e.target.value))} /><span>{ordered.at(-1) ? timestamp(ordered.at(-1)!.startedAt) : 'Now'}</span></label>
      <div className="activity-replay-caption"><span>{settings.pace === 'time' ? `${settings.amount} ${settings.unit}${settings.amount === 1 ? '' : 's'} / second` : `${settings.amount} activities / second`}{settings.loop ? ' · Loop' : ''}</span><span>Drag to pan · wheel to zoom · arrows show message direction</span></div>
    </div>
  </div>;
}
