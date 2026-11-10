import { describe, expect, it } from 'vitest';
import type { ActivityActor, ActivityRecord } from '../types/activity';
import { actorKey } from './activityGraph';
import { bubbleFrame, bubblePosition, DEFAULT_REPLAY, latestActivity, replayIndex, replaySchedule, replaySettings, USER_BUBBLE } from './activityReplay';
const a: ActivityActor = { id: 'a', name: 'Same name', provider: 'claude', model: null, device: null };
const b: ActivityActor = { ...a, id: 'b', provider: 'codex' };
const turn = (id: string, startedAt: number, actor = a): ActivityRecord => ({ id, actor, startedAt, updatedAt: startedAt, kind: 'turn', origin: 'user',
  target: null, sessionId: 's', status: 'completed', prompt: 'Question', response: 'Answer', parentId: null, usageNote: null,
  usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 0, reasoning: 15 } });
describe('activity playback', () => {
  it('plays a recorded day per second and can cap quiet gaps at two seconds', () => {
    const records = [turn('a', 0), turn('b', 86_400_000), turn('c', 864_000_000)];
    expect(replaySchedule(records, { ...DEFAULT_REPLAY, skipGaps: false }).moments).toEqual([0, 1000, 10000]);
    expect(replaySchedule(records, DEFAULT_REPLAY).moments).toEqual([0, 1000, 3000]);
  });
  it('shows equal-timestamp messages one at a time in event mode and honors speed', () => {
    const records = [turn('c', 10), turn('a', 10), turn('b', 10)];
    const schedule = replaySchedule(records, { ...DEFAULT_REPLAY, pace: 'events', amount: 2 });
    expect(schedule.ids).toEqual(['a', 'b', 'c']);
    expect(schedule.moments).toEqual([0, 500, 1000]);
    expect([0, 499, 500, 999, 1000, 1500].map(t => replayIndex(schedule.moments, t))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(schedule.duration).toBe(1500);
  });
  it('follows updates to an older active turn, not just newly created turns', () => {
    expect(latestActivity([turn('new', 200), { ...turn('older', 100), updatedAt: 300 }])?.id).toBe('older');
    expect(latestActivity([])).toBeUndefined();
  });
  it('sanitizes saved options and keeps playback finite', () => {
    expect(replaySettings(null)).toEqual(DEFAULT_REPLAY);
    expect(replaySettings({ amount: Infinity, unit: 'constructor', trail: -1 })).toEqual(DEFAULT_REPLAY);
    expect(replaySettings({ pace: 'events', amount: -3, loop: true })).toMatchObject({ pace: 'events', amount: .1, loop: true });
  });
});
describe('chat bubbles', () => {
  it('keeps direction and chat identity, without double-counting a received handoff or tokens', () => {
    const records = [turn('question', 0), { ...turn('send', 1), kind: 'handoff' as const, target: b },
      { ...turn('received', 2, b), origin: 'panel', parentId: 'send' },
      { ...turn('reply', 3, b), kind: 'handoff' as const, target: a }];
    const frame = bubbleFrame(records, 3, 0);
    expect(frame.links.map(l => [l.from, l.to, l.count])).toEqual([[USER_BUBBLE, actorKey(a), 1], [actorKey(a), actorKey(b), 1], [actorKey(b), actorKey(a), 1]]);
    expect([...frame.totals.values()].map(t => t.tokens)).toEqual([60, 60]);
  });
  it('uses a 500-event window while allowing replay through all loaded history', () => {
    const records = Array.from({ length: 750 }, (_, i) => turn(String(i), i * 1000));
    expect(bubbleFrame(records, 499, 0).visible).toHaveLength(500);
    const end = bubbleFrame(records, 749, 0);
    expect(end.visible).toHaveLength(500);
    expect(end.visible[0].id).toBe('250');
    expect(bubbleFrame(records, 200, 60_000).visible).toHaveLength(61);
    expect(replaySchedule(records, DEFAULT_REPLAY).ids).toHaveLength(750);
  });
  it('does not invent sender links or include future records while replaying', () => {
    const records = [{ ...turn('unknown', 1), origin: 'panel', parentId: 'outside-page' }, turn('future', 2)];
    expect(bubbleFrame(records, 0, 0).links).toEqual([]);
    expect(bubbleFrame(records, 0, 0).totals.get(actorKey(a))?.turns).toBe(1);
  });
  it('keeps bubble slots separated and finite for 500 distinct chats', () => {
    const points = Array.from({ length: 500 }, (_, i) => bubblePosition(i));
    expect(new Set(points.map(p => JSON.stringify(p))).size).toBe(500);
    expect(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    for (let i = 0; i < points.length; i++) for (let j = 0; j < i; j++) expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)).toBeGreaterThan(150);
  });
});
