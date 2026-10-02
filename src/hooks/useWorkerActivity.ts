import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useChatStore } from '../store/chatStore';
import { useCodexStore } from '../store/codexStore';
import { useOpenCodeStore } from '../store/opencodeStore';
import { useAntigravityStore } from '../store/antigravityStore';
import { useLlmChatStore } from '../store/llmChatStore';
import { useOfficeGameStore } from '../store/officeGameStore';
import { useLayoutStore } from '../store/layoutStore';
import { workerDestination } from '../lib/officeSpace';
import { antigravitySignal, claudeSignal, codexSignal, openCodeSignal, recordedSignal, cleanTask, rewardForTools, type WorkSignal } from '../lib/officeActivity';
import type { ActivityPage, ActivityRecord } from '../types/activity';

/** Stable record IDs make polling, replay, and reopening the office idempotent. */
export function ingestOfficeRecords(records: ActivityRecord[]) {
  for (const r of records) {
    const store = useOfficeGameStore.getState();
    if (r.kind !== 'turn' || r.status !== 'completed' || r.startedAt < store.startedAt || r.actor.device) continue;
    store.claimReward({ id: r.id, panelId: r.actor.id, name: r.actor.name, task: cleanTask(r.prompt),
      coins: rewardForTools(r.tools ?? []), at: r.updatedAt });
  }
}

/** App-wide: characters and rewards keep updating while panels are visible. */
export function useWorkerActivity(): void {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let lastFullScan = 0;
    let since = useOfficeGameStore.getState().startedAt;
    const latest = new Map<string, ActivityRecord>();
    const latestBySession = new Map<string, ActivityRecord>();
    const inFlight = new Map<string, { id: string; task: string; tools: Set<string> }>();

    function sync() {
      timer = undefined;
      if (disposed) return;
      const panelTypes = useLayoutStore.getState().panelTypes;
      const instances = new Map([...useInstanceStore.getState().instances].filter(([id]) => !['computer', 'widget', 'plugin', 'group', 'remote'].includes(panelTypes[id])));
      for (const id of Object.keys(useOfficeGameStore.getState().workers)) {
        if (!instances.has(id)) { useOfficeGameStore.getState().removeWorker(id); inFlight.delete(id); }
      }
      const occupied = new Set<string>();
      let index = 0;
      for (const [id, instance] of instances) {
        const store = useOfficeGameStore.getState();
        let state: WorkSignal;
        // LLM and OpenCode do not yet enter native Activity history. Award only
        // a turn whose running state was observed, never imported old messages.
        let supplemental: { running: boolean; completed: boolean; key: string; tools: string[] } | undefined;
        if (instance.config.llmConfig) {
          const conv = useLlmChatStore.getState().conversations[id];
          const question = conv?.messages.filter(m => m.role === 'user').at(-1);
          state = { activity: conv?.error ? 'error' : conv?.isStreaming ? 'responding' : 'idle', task: cleanTask(question?.content ?? ''), detail: conv?.error ?? '' };
          supplemental = { running: !!conv?.isStreaming, completed: !!conv && !conv.isStreaming && !conv.error && !conv.cancelled && conv.messages.at(-1)?.role === 'assistant' && !!conv.messages.at(-1)?.content.trim(), key: `llm:${question?.id ?? ''}`, tools: [] };
        } else if (instance.config.agentProvider === 'codex') {
          state = codexSignal(useCodexStore.getState().sessions[id]);
        } else if (instance.config.agentProvider === 'opencode') {
          const session = useOpenCodeStore.getState().sessions[id];
          state = openCodeSignal(session);
          const question = session?.messages.filter(m => m.info.role === 'user').at(-1);
          const answer = session?.messages.at(-1);
          supplemental = { running: session?.status.type === 'busy', completed: !!session?.connected && session.status.type === 'idle' && !session.error && answer?.info.role === 'assistant' && !answer.info.error,
            key: `opencode:${session?.sessionId}:${question?.info.id}`, tools: session?.messages.filter(m => m.info.id > (question?.info.id ?? '')).flatMap(m => m.parts.filter(p => p.type === 'tool').map(p => p.tool ?? 'Tool')) ?? [] };
        } else if (instance.config.agentProvider === 'antigravity') {
          // Chat turns are recorded natively in Activity (rewards come from those
          // records, once per turn ID). The native TUI reports nothing structured.
          state = instance.config.panelView !== 'terminal' ? antigravitySignal(useAntigravityStore.getState().sessions[id])
            : { activity: instance.status === 'error' ? 'error' : 'unknown', task: '', detail: instance.status === 'stopped' ? 'Session stopped' : 'The Antigravity terminal reports no structured activity' };
        } else if (instance.config.panelView === 'terminal') {
          const record = instance.claudeSessionId ? latestBySession.get(`claude:${instance.claudeSessionId}`) : latest.get(id);
          state = instance.status === 'stopped' || instance.status === 'error'
            ? { activity: instance.status === 'error' ? 'error' : 'unknown', task: record?.prompt ?? '', detail: 'Session stopped' }
            : recordedSignal(record);
        } else {
          state = claudeSignal(useChatStore.getState().sessions.get(id));
        }
        if (supplemental?.running) {
          const previous = inFlight.get(id);
          inFlight.set(id, { id: supplemental.key, task: state.task, tools: new Set([...(previous?.id === supplemental.key ? previous.tools : []), ...supplemental.tools]) });
        } else if (supplemental && inFlight.has(id)) {
          const turn = inFlight.get(id)!;
          inFlight.delete(id);
          if (supplemental.completed && supplemental.key === turn.id) store.claimReward({ id: turn.id, panelId: id, name: instance.name, task: turn.task, coins: rewardForTools([...turn.tools]), at: Date.now() });
        }
        let worker = useOfficeGameStore.getState().workers[id];
        if (!worker) {
          store.addWorker(id, workerDestination(store.layout, 'new', index, occupied));
          worker = useOfficeGameStore.getState().workers[id];
        }
        const target = workerDestination(store.layout, state.activity, index++, occupied);
        occupied.add(`${target.gridX},${target.gridY}`);
        // Avoid writing persistent storage on every streamed token.
        if (worker.activity !== state.activity || worker.task !== state.task || worker.detail !== state.detail || worker.targetPosition.gridX !== target.gridX || worker.targetPosition.gridY !== target.gridY)
          store.updateWorker(id, state.activity, state.task, state.detail, target);
      }
    }
    function schedule() { if (!timer && !disposed) timer = setTimeout(sync, 60); }
    async function poll() {
      if (disposed) return;
      try {
        const store = useOfficeGameStore.getState();
        const full = Date.now() - lastFullScan > 300000;
        const scanSince = full ? store.startedAt : Math.max(store.startedAt, since - 60000);
        const records = new Map<string, ActivityRecord>();
        let before: { at: number; id: string } | null = null;
        const pending = store.pendingRecords;
        // Activity must include an already-running terminal turn, even if it
        // predates the game or its panel got a new ID during workspace restore.
        const liveSessions = [...useInstanceStore.getState().instances.values()]
          .filter(i => !i.config.llmConfig && (i.config.agentProvider ?? 'claude') === 'claude' && i.config.panelView === 'terminal' && i.claudeSessionId)
          .map(i => ({ provider: 'claude', sessionId: i.claudeSessionId! }));
        let refreshOffset = 0;
        do {
          const refreshIds = pending.slice(refreshOffset, refreshOffset + 1000);
          const page: ActivityPage = await invoke('activity_list', { since: scanSince, before, limit: 500, refreshIds, liveSessions: before === null ? liveSessions : [] });
          if (disposed) return;
          if (page.health.error) throw new Error(page.health.error);
          for (const r of page.records) records.set(r.id, r);
          // Native pagination puts the 500 page rows first, then appends
          // refreshed records. A refreshed old turn must not skip a page.
          const last: ActivityRecord | undefined = page.hasMore ? page.records[499] : undefined;
          before = page.hasMore && last ? { at: last.startedAt, id: last.id } : null;
          refreshOffset += 1000;
        } while (!disposed && (before || refreshOffset < pending.length));
        const collected = [...records.values()];
        ingestOfficeRecords(collected);
        const waiting = new Set(store.pendingRecords);
        for (const r of collected) {
          if (r.kind !== 'turn') continue;
          if (['completed', 'failed', 'interrupted'].includes(r.status)) waiting.delete(r.id); else waiting.add(r.id);
          const previous = latest.get(r.actor.id);
          if (!previous || r.startedAt >= previous.startedAt) latest.set(r.actor.id, r);
          const key = `${r.actor.provider}:${r.sessionId}`, previousSession = latestBySession.get(key);
          if (!previousSession || r.startedAt > previousSession.startedAt || (r.startedAt === previousSession.startedAt && r.updatedAt >= previousSession.updatedAt)) latestBySession.set(key, r);
          since = Math.max(since, r.startedAt);
        }
        useOfficeGameStore.setState({ syncError: null, pendingRecords: [...waiting] });
        if (full) lastFullScan = Date.now();
        sync();
      } catch (error) {
        if (!disposed) useOfficeGameStore.setState({ syncError: `Rewards will catch up when activity reconnects. ${String(error)}` });
      } finally { if (!disposed) pollTimer = setTimeout(poll, 5000); }
    }
    const unsubscribe = [useInstanceStore.subscribe(schedule), useLayoutStore.subscribe((s, old) => { if (s.panelTypes !== old.panelTypes) schedule(); }), useChatStore.subscribe(schedule), useCodexStore.subscribe(schedule), useOpenCodeStore.subscribe(schedule), useAntigravityStore.subscribe(schedule), useLlmChatStore.subscribe(schedule),
      useOfficeGameStore.subscribe((s, old) => { if (s.layout !== old.layout) schedule(); })];
    sync();
    void poll();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(pollTimer); unsubscribe.forEach(unsub => unsub()); };
  }, []);
}
