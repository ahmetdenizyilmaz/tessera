import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useOpenCodeStore } from '../store/opencodeStore';
import type { OpenCodeConfig, OpenCodeSnapshot } from '../types/opencode';
import { peekForkContext, markForkConsumed } from './forkActions';
import { snapshot as panelRoster } from './panelBus';
import { useLayoutStore } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';

const configuring = new Map<string, Promise<void>>();
const watchers = new Map<string, ReturnType<typeof setTimeout>>();
const epochs = new Map<string, number>();
const polls = new Map<string, number>();
export function openCodeConfig(id: string): OpenCodeConfig {
  const inst = useInstanceStore.getState().instances.get(id);
  if (!inst?.config.opencode || !inst.opencodeDataId) throw new Error('OpenCode configuration is missing.');
  return { ...inst.config.opencode, cwd: inst.config.cwd, model: inst.config.model, dataId: inst.opencodeDataId };
}
function apply(id: string, snapshot: OpenCodeSnapshot) {
  if (!useInstanceStore.getState().instances.has(id)) return;
  useOpenCodeStore.getState().receive(id, snapshot);
  const inst = useInstanceStore.getState().instances.get(id)!;
  const model = snapshot.model || inst.config.model;
  const options = inst.config.opencode;
  const agent = snapshot.agent || options?.agent;
  const status = inst.config.panelView === 'terminal' && (inst.status === 'stopped' || inst.status === 'error') ? inst.status : 'running';
  if (inst.opencodeSessionId !== snapshot.sessionId || inst.status !== status || model !== inst.config.model || agent !== options?.agent)
    useInstanceStore.getState().updateInstance(id, { opencodeSessionId: snapshot.sessionId, status, config: options && agent ? { ...inst.config, model, opencode: { ...options, model, agent } } : inst.config });
}
export async function refreshOpenCode(id: string, force = false): Promise<void> {
  const epoch = epochs.get(id);
  const poll = (polls.get(id) ?? 0) + 1;
  polls.set(id, poll);
  const result = await invoke<OpenCodeSnapshot | null>('opencode_snapshot', { id, knownRevision: force ? null : useOpenCodeStore.getState().sessions[id]?.revision ?? null });
  if (result && epochs.get(id) === epoch && polls.get(id) === poll) apply(id, result);
}
function watch(id: string, epoch: number) {
  if (epochs.get(id) !== epoch || !useInstanceStore.getState().instances.has(id)) return;
  watchers.set(id, setTimeout(async () => {
    try { await refreshOpenCode(id); }
    catch (e) {
      if (epochs.get(id) !== epoch) return;
      useOpenCodeStore.getState().error(id, String(e), true);
      useInstanceStore.getState().setStatus(id, 'error');
      watchers.delete(id);
      return;
    }
    watch(id, epoch);
  }, useOpenCodeStore.getState().sessions[id]?.status.type === 'idle' ? 1200 : 300));
}
export function stopOpenCodeWatch(id: string) {
  epochs.set(id, (epochs.get(id) ?? 0) + 1);
  clearTimeout(watchers.get(id)); watchers.delete(id);
  useOpenCodeStore.getState().remove(id);
}
export async function ensureOpenCode(id: string): Promise<void> {
  if (configuring.has(id)) return configuring.get(id);
  if (useOpenCodeStore.getState().sessions[id]?.connected && !useInstanceStore.getState().instances.get(id)?.config.fork?.pending) return;
  const task = (async () => {
    const inst = useInstanceStore.getState().instances.get(id);
    if (!inst || inst.config.agentProvider !== 'opencode') throw new Error('OpenCode panel not found.');
    if (!inst.opencodeDataId) useInstanceStore.getState().updateInstance(id, { opencodeDataId: crypto.randomUUID() });
    const epoch = (epochs.get(id) ?? 0) + 1;
    epochs.set(id, epoch);
    const result = await invoke<OpenCodeSnapshot>('opencode_configure', { id, config: openCodeConfig(id), sessionId: inst.opencodeSessionId ?? null });
    if (epochs.get(id) !== epoch || !useInstanceStore.getState().instances.has(id)) {
      await invoke('opencode_close', { id });
      throw new Error('Panel creation was cancelled.');
    }
    apply(id, result);
    // noReply imports context without asking for a summary or starting a model turn.
    const context = peekForkContext(id);
    if (context) {
      const seeded = result.messages.some(message => message.info.role === 'user' && message.parts.some(part => part.type === 'text' && part.text === context));
      if (!seeded) await invoke('opencode_seed', { id, text: context });
      markForkConsumed(id);
      await refreshOpenCode(id);
    }
    watch(id, epoch);
  })();
  configuring.set(id, task);
  try { await task; }
  catch (e) { if (useInstanceStore.getState().instances.has(id)) useOpenCodeStore.getState().error(id, String(e), true); throw e; }
  finally { configuring.delete(id); }
}

/** Restore hidden/grouped sessions too: LAN reads and MCP must not depend on
 * whether their React chat view has ever mounted. Starting makes no model call. */
export function initOpenCodeBridge(): () => void {
  const attempted = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const live = new Set(panelRoster().filter(panel => panel.provider === 'opencode').map(panel => panel.id));
      for (const id of attempted) if (!live.has(id)) { attempted.delete(id); stopOpenCodeWatch(id); }
      for (const id of live) {
        if (attempted.has(id)) continue;
        attempted.add(id);
        void ensureOpenCode(id).catch(() => {
          if (useInstanceStore.getState().instances.has(id)) useInstanceStore.getState().setStatus(id, 'error');
        });
      }
    }, 100);
  };
  const unsubscribers = [useInstanceStore.subscribe(schedule), useLayoutStore.subscribe(schedule), useGroupStore.subscribe(schedule)];
  schedule();
  return () => { clearTimeout(timer); unsubscribers.forEach(unsubscribe => unsubscribe()); attempted.forEach(stopOpenCodeWatch); };
}
