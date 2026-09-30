import { expect, it } from 'vitest';
import type { ActivityActor, ActivityRecord } from '../types/activity';
import { activityGraph, activitySummary, mergeActivity, tokenTotal } from './activityGraph';
const claude: ActivityActor = { id: 'a', name: 'Review', provider: 'claude', model: null, device: null };
const codex: ActivityActor = { id: 'b', name: 'Review', provider: 'codex', model: null, device: null };
const turn = (id: string, at: number, actor = claude): ActivityRecord => ({ id, startedAt: at, updatedAt: at, kind: 'turn', actor, target: null,
  sessionId: 's', status: 'completed', prompt: 'Question', response: 'Answer', parentId: null, usageNote: null, origin: 'user',
  usage: { input: 10, output: 30, cacheRead: 60, cacheWrite: 0, reasoning: 20 } });
it('draws the recorded user → Codex → Claude flow without confusing identical chat names', () => {
  const a = turn('codex-question', 1, codex);
  const b = { ...turn('handoff', 2, codex), kind: 'handoff' as const, target: claude, parentId: a.id, usage: null };
  const c = { ...turn('claude-answer', 3), parentId: b.id, origin: 'panel' };
  const graph = activityGraph([c, a, b]);
  expect(graph.lanes).toHaveLength(2);
  expect(graph.edges.map(e => [e.from, e.to])).toEqual([[undefined, a.id], [a.id, b.id], [b.id, c.id]]);
  expect(graph.nodes[0].lane).not.toBe(graph.nodes[2].lane);
});
it('does not invent causal links when a parent is outside a filtered page', () => {
  const graph = activityGraph([{ ...turn('reply', 2), origin: 'panel', parentId: 'not-loaded' }]);
  expect(graph.edges).toEqual([]);
});
it('totals exclude handoffs and do not count reasoning or cached input twice', () => {
  const a = turn('a', 1);
  const b = { ...turn('b', 2), usage: null };
  const handoff = { ...turn('h', 3), kind: 'handoff' as const };
  const result = activitySummary([a, b, handoff]);
  expect(tokenTotal(a.usage)).toBe(100);
  expect(result).toMatchObject({ total: 100, missing: 1, turns: 2, handoffs: 1 });
});
it('merges live updates without losing earlier pages or duplicating usage', () => {
  const old = turn('old', 1);
  const current = turn('current', 2);
  const updated = { ...current, response: 'Final answer', usage: { ...current.usage!, output: 50 } };
  const records = mergeActivity([old, current], [updated, turn('new', 3)]);
  expect(records.map(r => r.id)).toEqual(['old', 'current', 'new']);
  expect(records[1].response).toBe('Final answer');
  expect(activitySummary(records).total).toBe(320);
});
