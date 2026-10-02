import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useAntigravityStore } from '../store/antigravityStore';
import type { AntigravityConfig, AntigravityOptions, AntigravitySnapshot } from '../types/antigravity';
import { snapshot as panelRoster } from './panelBus';
import { useLayoutStore } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';

const configuring = new Map<string, Promise<void>>();
const watchers = new Map<string, ReturnType<typeof setTimeout>>();
const epochs = new Map<string, number>();
const polls = new Map<string, number>();

export function antigravityConfig(id: string): AntigravityConfig {
  const inst = useInstanceStore.getState().instances.get(id);
  if (!inst?.config.antigravity || !inst.antigravityDataId) throw new Error('Antigravity configuration is missing.');
  return { ...inst.config.antigravity, cwd: inst.config.cwd, model: inst.config.model, dataId: inst.antigravityDataId };
}

function apply(id: string, snapshot: AntigravitySnapshot) {
  const inst = useInstanceStore.getState().instances.get(id);
  if (!inst) return;
  useAntigravityStore.getState().receive(id, snapshot);
  const terminal = inst.config.panelView === 'terminal';
  // A terminal's status belongs to its PTY; a chat panel is usable whenever it is configured.
  const status = terminal ? inst.status : 'running';
  const conversation = snapshot.conversationId ?? undefined;
  if (inst.antigravityConversationId !== conversation || inst.status !== status)
    useInstanceStore.getState().updateInstance(id, { antigravityConversationId: conversation, status });
}

export async function refreshAntigravity(id: string, force = false): Promise<void> {
  const epoch = epochs.get(id);
  const poll = (polls.get(id) ?? 0) + 1;
  polls.set(id, poll);
  const result = await invoke<AntigravitySnapshot | null>('antigravity_snapshot', { id, knownRevision: force ? null : useAntigravityStore.getState().sessions[id]?.revision ?? null });
  if (result && epochs.get(id) === epoch && polls.get(id) === poll) apply(id, result);
}

function watch(id: string, epoch: number) {
  if (epochs.get(id) !== epoch || !useInstanceStore.getState().instances.has(id)) return;
  watchers.set(id, setTimeout(async () => {
    try { await refreshAntigravity(id); }
    catch (e) {
      if (epochs.get(id) !== epoch) return;
      useAntigravityStore.getState().error(id, String(e), true);
      watchers.delete(id);
      return;
    }
    watch(id, epoch);
  }, useAntigravityStore.getState().sessions[id]?.busy ? 250 : 1200));
}

export function stopAntigravityWatch(id: string) {
  epochs.set(id, (epochs.get(id) ?? 0) + 1);
  clearTimeout(watchers.get(id)); watchers.delete(id);
  useAntigravityStore.getState().remove(id);
}

/** Register the panel with the backend. `start` also launches agy and waits for
 *  its conversation ID (new chat panels); restored panels stay process-free until
 *  their next message, so opening a workspace costs no CLI start or model call. */
export async function ensureAntigravity(id: string, start = false): Promise<void> {
  if (configuring.has(id)) return configuring.get(id);
  if (useAntigravityStore.getState().sessions[id]?.configured && !start) return;
  const task = (async () => {
    const inst = useInstanceStore.getState().instances.get(id);
    if (!inst || inst.config.agentProvider !== 'antigravity') throw new Error('Antigravity panel not found.');
    if (!inst.antigravityDataId) useInstanceStore.getState().updateInstance(id, { antigravityDataId: crypto.randomUUID() });
    const epoch = (epochs.get(id) ?? 0) + 1;
    epochs.set(id, epoch);
    clearTimeout(watchers.get(id)); watchers.delete(id);
    const result = await invoke<AntigravitySnapshot>('antigravity_configure', { id, config: antigravityConfig(id), conversationId: inst.antigravityConversationId ?? null, start });
    if (epochs.get(id) !== epoch || !useInstanceStore.getState().instances.has(id)) {
      await invoke('antigravity_close', { id });
      throw new Error('Panel creation was cancelled.');
    }
    apply(id, result);
    watch(id, epoch);
  })();
  configuring.set(id, task);
  try { await task; }
  catch (e) { if (useInstanceStore.getState().instances.has(id)) useAntigravityStore.getState().error(id, String(e), true); throw e; }
  finally { configuring.delete(id); }
}

/** Change model or permissions on an idle panel. agy takes them as process flags,
 *  so the backend restarts the process and resumes the same conversation. */
export async function reconfigureAntigravity(id: string, change: Partial<AntigravityOptions>): Promise<void> {
  const inst = useInstanceStore.getState().instances.get(id);
  if (!inst?.config.antigravity) return;
  const previous = inst.config;
  const antigravity = { ...inst.config.antigravity, ...change };
  useInstanceStore.getState().updateInstance(id, { config: { ...inst.config, model: antigravity.model, antigravity } });
  try {
    apply(id, await invoke<AntigravitySnapshot>('antigravity_configure', { id, config: antigravityConfig(id), conversationId: inst.antigravityConversationId ?? null, start: false }));
  } catch (e) {
    const current = useInstanceStore.getState().instances.get(id);
    if (current) useInstanceStore.getState().updateInstance(id, { config: { ...current.config, model: previous.model, antigravity: previous.antigravity } });
    useAntigravityStore.getState().error(id, String(e));
    throw e;
  }
}

/** Configure hidden/grouped panels too: LAN reads and panel messages must not
 *  depend on whether the React chat view has ever mounted. Starts no process. */
export function initAntigravityBridge(): () => void {
  const attempted = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const live = new Set(panelRoster().filter(panel => panel.provider === 'antigravity').map(panel => panel.id));
      for (const id of attempted) if (!live.has(id)) { attempted.delete(id); stopAntigravityWatch(id); }
      for (const id of live) {
        if (attempted.has(id)) continue;
        attempted.add(id);
        void ensureAntigravity(id).catch(() => {});
      }
    }, 100);
  };
  const unsubscribers = [useInstanceStore.subscribe(schedule), useLayoutStore.subscribe(schedule), useGroupStore.subscribe(schedule)];
  schedule();
  return () => { clearTimeout(timer); unsubscribers.forEach(unsubscribe => unsubscribe()); attempted.forEach(stopAntigravityWatch); };
}
