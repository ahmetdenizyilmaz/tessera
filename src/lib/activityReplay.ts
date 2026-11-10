import type { ActivityRecord } from '../types/activity';
import { ACTIVITY_GRAPH_LIMIT, actorKey, byTime, tokenTotal } from './activityGraph';

export const USER_BUBBLE = 'activity:user';
export const REPLAY_UNITS = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
export interface ReplaySettings {
  pace: 'time' | 'events';
  amount: number;
  unit: keyof typeof REPLAY_UNITS;
  skipGaps: boolean;
  loop: boolean;
  trail: number;
}
export const DEFAULT_REPLAY: ReplaySettings = { pace: 'time', amount: 1, unit: 'day', skipGaps: true, loop: false, trail: 0 };
export function replaySettings(value: unknown): ReplaySettings {
  const v = value && typeof value === 'object' ? value as Partial<ReplaySettings> : {};
  return {
    pace: v.pace === 'events' ? 'events' : 'time',
    amount: typeof v.amount === 'number' && Number.isFinite(v.amount) ? Math.max(.1, Math.min(100, v.amount)) : 1,
    unit: v.unit && Object.hasOwn(REPLAY_UNITS, v.unit) ? v.unit : 'day',
    skipGaps: typeof v.skipGaps === 'boolean' ? v.skipGaps : true,
    loop: v.loop === true,
    trail: [0, 60_000, 3_600_000, 86_400_000].includes(v.trail ?? -1) ? v.trail! : 0,
  };
}

/** Milliseconds on the playback clock, separate from recorded wall time. */
export function replaySchedule(records: ActivityRecord[], settings: ReplaySettings) {
  const ordered = [...records].sort(byTime);
  const moments: number[] = [];
  for (let i = 0; i < ordered.length; i++) {
    let gap = settings.pace === 'events' ? 1000 / settings.amount
      : (ordered[i].startedAt - (ordered[i - 1]?.startedAt ?? ordered[i].startedAt)) / (REPLAY_UNITS[settings.unit] * settings.amount) * 1000;
    if (settings.pace === 'time' && settings.skipGaps) gap = Math.min(gap, 2000);
    moments.push(i ? moments[i - 1] + gap : 0);
  }
  return { ids: ordered.map(r => r.id), moments, duration: (moments.at(-1) ?? 0) + (settings.pace === 'events' ? 1000 / settings.amount : 1000) };
}
export function replayIndex(moments: number[], elapsed: number) {
  let low = 0, high = moments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (moments[middle] <= elapsed) low = middle + 1; else high = middle;
  }
  return Math.max(0, low - 1);
}
export function latestActivity(records: ActivityRecord[]) {
  return records.reduce<ActivityRecord | undefined>((latest, record) => {
    const at = Math.max(record.startedAt, record.updatedAt);
    const previous = latest ? Math.max(latest.startedAt, latest.updatedAt) : -Infinity;
    return at > previous || (at === previous && latest && byTime(record, latest) > 0) ? record : latest;
  }, undefined);
}

export interface BubbleLink { key: string; from: string; to: string; kind: 'user' | 'handoff'; count: number; latest: ActivityRecord }
export function bubbleRoute(record: ActivityRecord) {
  if (record.kind === 'handoff' && record.target) return { from: actorKey(record.actor), to: actorKey(record.target), kind: 'handoff' as const };
  if (record.kind === 'turn' && record.origin === 'user') return { from: USER_BUBBLE, to: actorKey(record.actor), kind: 'user' as const };
  // An incoming turn is not a second sent message. Missing parents never
  // imply an invented connection between two chats with similar names.
  return null;
}
export function bubbleFrame(records: ActivityRecord[], through: number, trail: number) {
  const end = Math.min(records.length, through + 1);
  const at = records[Math.max(0, end - 1)]?.startedAt ?? 0;
  const visible = records.slice(Math.max(0, end - ACTIVITY_GRAPH_LIMIT), end).filter(r => !trail || r.startedAt >= at - trail);
  const links = new Map<string, BubbleLink>();
  const totals = new Map<string, { turns: number; tokens: number; missing: number }>();
  for (const record of visible) {
    if (record.kind === 'turn') {
      const key = actorKey(record.actor), total = totals.get(key) ?? { turns: 0, tokens: 0, missing: 0 };
      total.turns++; total.tokens += tokenTotal(record.usage); if (!record.usage) total.missing++;
      totals.set(key, total);
    }
    const route = bubbleRoute(record);
    if (!route) continue;
    const key = JSON.stringify([route.from, route.to]);
    const previous = links.get(key);
    links.set(key, { key, ...route, count: (previous?.count ?? 0) + 1, latest: record });
  }
  return { visible, links: [...links.values()], totals };
}

/** Append-only ring slots keep existing chats still when a new one appears. */
export function bubblePosition(slot: number) {
  let ring = 1;
  while (slot >= 6 * ring) { slot -= 6 * ring; ring++; }
  const angle = -Math.PI / 2 + slot * Math.PI * 2 / (6 * ring);
  return { x: Math.cos(angle) * ring * 255, y: Math.sin(angle) * ring * 255 };
}
