import type { ActivityActor, ActivityRecord, ActivityUsage } from '../types/activity';

export const providerName = (provider: string) => ({ claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', antigravity: 'Antigravity', unknown: 'Agent' }[provider] ?? provider);
export const actorKey = (actor: ActivityActor) => `${actor.provider}:${actor.id}`;
export const tokenTotal = (usage: ActivityUsage | null) => usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite : 0;
export const shortTokens = (tokens: number) => tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
export const byTime = (a: ActivityRecord, b: ActivityRecord) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function mergeActivity(previous: ActivityRecord[], incoming: ActivityRecord[]) {
  const map = new Map(previous.map(record => [record.id, record]));
  for (const record of incoming) map.set(record.id, record);
  return [...map.values()].sort(byTime);
}

export function activitySummary(records: ActivityRecord[]) {
  const usage: ActivityUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  let missing = 0;
  const turns = records.filter(r => r.kind === 'turn');
  for (const turn of turns) {
    if (!turn.usage) { missing++; continue; }
    for (const key of Object.keys(usage) as Array<keyof ActivityUsage>) usage[key] += turn.usage[key];
  }
  return { usage, total: tokenTotal(usage), missing, turns: turns.length, handoffs: records.filter(r => r.kind === 'handoff').length };
}

export interface GraphNode { record: ActivityRecord; x: number; y: number; lane: string }
export interface GraphEdge { id: string; from?: string; to: string; label: string; handoff?: string; kind: 'user' | 'handoff' }
export function activityGraph(records: ActivityRecord[]) {
  const sorted = [...records].sort(byTime);
  const actors = new Map<string, ActivityActor>();
  for (const r of sorted) {
    actors.set(actorKey(r.actor), r.actor);
    if (r.target) actors.set(actorKey(r.target), r.target);
  }
  const lanes = [...actors.entries()].map(([key, actor], i) => ({ key, actor, x: 130 + i * 300 }));
  const positions = new Map(lanes.map(lane => [lane.key, lane.x]));
  const nodes: GraphNode[] = sorted.map((record, i) => ({ record, lane: actorKey(record.actor), x: positions.get(actorKey(record.actor))!, y: 96 + i * 130 }));
  const ids = new Set(nodes.map(n => n.record.id));
  const edges: GraphEdge[] = [];
  for (const r of sorted) {
    if (r.parentId && ids.has(r.parentId)) {
      edges.push({ id: `${r.parentId}:${r.id}`, from: r.parentId, to: r.id, label: r.kind === 'handoff' ? 'asks' : 'received', handoff: r.kind === 'handoff' ? r.id : r.parentId, kind: 'handoff' });
    } else if (r.kind === 'turn' && r.origin === 'user') {
      edges.push({ id: `user:${r.id}`, to: r.id, label: 'You asked', kind: 'user' });
    }
  }
  return { lanes, nodes, edges, width: Math.max(550, 155 + lanes.length * 300), height: Math.max(350, 120 + nodes.length * 130) };
}
