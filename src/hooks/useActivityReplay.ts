import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityRecord } from '../types/activity';
import { DEFAULT_REPLAY, latestActivity, replayIndex, replaySchedule, replaySettings, type ReplaySettings } from '../lib/activityReplay';

const STORAGE_KEY = 'tessera.activity.replay.v1';
export function useActivityReplay(records: ActivityRecord[]) {
  const [settings, setSettings] = useState<ReplaySettings>(() => {
    try { return replaySettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')); }
    catch { return DEFAULT_REPLAY; }
  });
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState(false);
  const [cursorId, setCursorId] = useState<string | null>(() => records.at(-1)?.id ?? null);
  // Polls often update a response without changing the replay's timestamps.
  // Such a refresh must not restart the playback clock or its animation.
  const timingKey = JSON.stringify(records.map(r => [r.id, r.startedAt]));
  const schedule = useMemo(() => replaySchedule(records, settings), [timingKey, settings.pace, settings.amount, settings.unit, settings.skipGaps]);
  const found = schedule.ids.indexOf(cursorId ?? '');
  const index = found >= 0 ? found : Math.max(0, records.length - 1);
  const currentIndex = useRef(index); currentIndex.current = index;
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = schedule.moments[currentIndex.current] ?? 0;
    if (cursorId && !schedule.ids.includes(cursorId)) { setCursorId(schedule.ids.at(-1) ?? null); setPlaying(false); }
  }, [schedule]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Optional preferences. */ }
  }, [settings]);
  useEffect(() => {
    if (!playing || !schedule.ids.length) return;
    let frame = 0, last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null || document.hidden ? 0 : Math.min(250, now - last);
      last = now;
      elapsed.current += dt;
      if (elapsed.current >= schedule.duration) {
        if (settings.loop) elapsed.current %= schedule.duration;
        else { setCursorId(schedule.ids.at(-1)!); setPlaying(false); return; }
      }
      const next = replayIndex(schedule.moments, elapsed.current);
      if (next !== currentIndex.current) { currentIndex.current = next; setCursorId(schedule.ids[next]); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, schedule, settings.loop]);
  const seek = (next: number) => {
    const safe = Math.max(0, Math.min(records.length - 1, next));
    setLive(false); setPlaying(false); setCursorId(schedule.ids[safe] ?? null);
    elapsed.current = schedule.moments[safe] ?? 0;
  };
  const playPause = () => {
    if (playing) { setPlaying(false); return; }
    setLive(false);
    if (live || index === records.length - 1) { elapsed.current = 0; currentIndex.current = 0; setCursorId(schedule.ids[0] ?? null); }
    setPlaying(records.length > 0);
  };
  const goLive = () => {
    setPlaying(false); setLive(true); setCursorId(schedule.ids.at(-1) ?? null);
  };
  const active = live ? latestActivity(records) : records[index];
  return {
    settings, configure: (patch: Partial<ReplaySettings>) => setSettings(s => replaySettings({ ...s, ...patch })),
    playing, live, index, active, through: live ? records.length - 1 : index,
    seek, playPause, goLive,
    pause: () => { setPlaying(false); if (live) seek(records.findIndex(r => r.id === active?.id)); },
  };
}
