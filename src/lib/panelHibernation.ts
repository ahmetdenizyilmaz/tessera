import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { useCodexStore } from '../store/codexStore';
import { useChatStore } from '../store/chatStore';
import { useOpenCodeStore } from '../store/opencodeStore';
import { useAntigravityStore } from '../store/antigravityStore';
import { usePanelHibernationStore, isPanelSuspended, type PanelPreview } from '../store/panelHibernationStore';
import { readTerminalPreview } from './terminalSharing';
import { panelWorkState } from './panelWorkState';
import { hasPanelDraft } from '../hooks/usePanelDraft';
import { hasTerminalDraft, isPanelViewed, panelActivityRevision, touchPanel } from './panelActivityClock';
import { canAutoHibernate, normalizeHibernation, supportsHibernation } from './panelHibernationPolicy';

const operations = new Map<string, Promise<void>>();
export const UNUSED_PANEL_MINUTES = 30;
export interface HibernateUnusedResult { hibernated: number; skipped: number; failed: number }
let unusedOperation: Promise<HibernateUnusedResult> | undefined;

function isIdleCandidate(id: string, minutes: number): boolean {
  const inst = useInstanceStore.getState().instances.get(id);
  const type = useLayoutStore.getState().panelTypes[id];
  if (!inst || !supportsHibernation(inst) || inst.config.fork?.openingMessage
    || ['remote', 'computer', 'widget', 'plugin', 'group'].includes(type)
    || usePanelHibernationStore.getState().phases[id]) return false;
  const saved = normalizeHibernation(inst.hibernation);
  return canAutoHibernate({ enabledMinutes: minutes, idleMs: saved.idleMs,
    focused: isPanelViewed(id), hasDraft: hasPanelDraft(id) || hasTerminalDraft(id),
    ...panelWorkState(id), starting: inst.status === 'starting', sleeping: saved.sleeping });
}

export function idlePanelIds(minutes = UNUSED_PANEL_MINUTES): string[] {
  return [...useInstanceStore.getState().instances.keys()].filter(id => isIdleCandidate(id, minutes));
}

/** One-off cleanup, independent of the automatic hibernation setting. */
export function hibernateUnusedPanels(): Promise<HibernateUnusedResult> {
  if (unusedOperation) return unusedOperation;
  unusedOperation = Promise.resolve().then(async () => {
    const result: HibernateUnusedResult = { hibernated: 0, skipped: 0, failed: 0 };
    for (const id of idlePanelIds()) {
      try {
        // Recheck each panel at execution time: a turn, draft or focus change
        // can happen while another panel's preview is being saved.
        await hibernatePanel(id, true, UNUSED_PANEL_MINUTES);
        if (useInstanceStore.getState().instances.get(id)?.hibernation?.sleeping) result.hibernated++;
        else result.skipped++;
      } catch { result.failed++; }
    }
    return result;
  }).finally(() => { unusedOperation = undefined; });
  return unusedOperation;
}

function phase(id: string, value?: 'hibernating' | 'waking', error?: string) {
  usePanelHibernationStore.setState(state => {
    const phases = { ...state.phases }, errors = { ...state.errors };
    if (value) phases[id] = value; else delete phases[id];
    if (error) errors[id] = error; else delete errors[id];
    return { phases, errors };
  });
}

function capturePreview(id: string): PanelPreview {
  const inst = useInstanceStore.getState().instances.get(id)!;
  if (inst.config.panelView === 'terminal') return readTerminalPreview(id) ?? { text: '', terminal: true };
  let lines: string[];
  switch (inst.config.agentProvider) {
    case 'codex': lines = (useCodexStore.getState().sessions[id]?.items ?? []).slice(-100).map(item =>
      item.text ?? item.content?.map(part => part.text ?? '').join('\n') ?? item.command ?? item.aggregatedOutput ?? ''); break;
    case 'opencode': lines = (useOpenCodeStore.getState().sessions[id]?.messages ?? []).slice(-80).map(m =>
      `${m.info.role}\n${m.parts.map(p => p.text ?? p.state?.output ?? '').join('\n')}`); break;
    case 'antigravity': lines = (useAntigravityStore.getState().sessions[id]?.items ?? []).slice(-100).map(item => item.text ?? item.output ?? ''); break;
    default: lines = (useChatStore.getState().sessions.get(id)?.messages ?? []).slice(-80).map(m =>
      `${m.role}\n${'text' in m ? m.text : m.blocks.map(b => b.type === 'text' ? b.text : b.type === 'tool_use' ? b.name : '').join('\n')}`);
  }
  return { text: lines.filter(Boolean).join('\n\n').slice(-60_000), terminal: false };
}

export function hibernatePanel(id: string, automatic = false, minimumIdleMinutes?: number): Promise<void> {
  const pending = operations.get(id);
  if (pending) return pending;
  const task = Promise.resolve().then(async () => {
    const inst = useInstanceStore.getState().instances.get(id);
    if (!inst || isPanelSuspended(id) || !supportsHibernation(inst)) return;
    if (minimumIdleMinutes !== undefined && !isIdleCandidate(id, minimumIdleMinutes)) return;
    const work = panelWorkState(id);
    if (inst.status === 'starting' || inst.config.fork?.openingMessage || work.busy || hasPanelDraft(id) || hasTerminalDraft(id))
      throw new Error('Finish the current turn or draft before hibernating this panel.');
    if (automatic && (!work.knownIdle || isPanelViewed(id))) return;
    const revision = panelActivityRevision(id);
    const preview = capturePreview(id);
    if (panelActivityRevision(id) !== revision) return;
    const previewId = inst.hibernation?.previewId ?? crypto.randomUUID();
    phase(id, 'hibernating');
    await invoke('panel_hibernate', { id, previewId, preview });
    // Closing/restoring a workspace during IPC must never resurrect its panel.
    if (!useInstanceStore.getState().instances.has(id)) return;
    usePanelHibernationStore.setState(s => ({ previews: { ...s.previews, [id]: preview } }));
    useInstanceStore.getState().updateInstance(id, { status: 'stopped', hibernation: {
      idleMs: inst.hibernation?.idleMs ?? 0, sleeping: true, previewId,
    } });
    const [{ cleanupPty, markFreshMount }, { clearTerminalState }, { stopOpenCodeWatch }, { stopAntigravityWatch }] = await Promise.all([
      import('../hooks/usePty'), import('../components/terminal/XTermView'), import('./opencodeBridge'), import('./antigravityBridge'),
    ]);
    cleanupPty(id, false);
    clearTerminalState(id);
    markFreshMount(id);
    stopOpenCodeWatch(id); stopAntigravityWatch(id);
    useCodexStore.getState().remove(id);
    useChatStore.getState().destroySession(id);
  }).catch(error => {
    phase(id, undefined, String(error).replace(/^Error: /, ''));
    throw error;
  }).finally(() => {
    const error = usePanelHibernationStore.getState().errors[id];
    phase(id, undefined, error);
    operations.delete(id);
  });
  operations.set(id, task);
  return task;
}

export function wakePanel(id: string): Promise<void> {
  const pending = operations.get(id);
  if (pending) return pending;
  const task = Promise.resolve().then(async () => {
    const inst = useInstanceStore.getState().instances.get(id);
    if (!inst?.hibernation?.sleeping) return;
    phase(id, 'waking');
    await invoke('panel_wake', { id });
    if (!useInstanceStore.getState().instances.has(id)) return;
    const { markFreshMount } = await import('../hooks/usePty');
    markFreshMount(id);
    touchPanel(id);
    useInstanceStore.getState().updateInstance(id, { status: 'starting',
      hibernation: { ...inst.hibernation, idleMs: 0, sleeping: false } });
    usePanelHibernationStore.setState(s => {
      const previews = { ...s.previews }; delete previews[id]; return { previews };
    });
  }).catch(error => {
    phase(id, undefined, String(error).replace(/^Error: /, ''));
    throw error;
  }).finally(() => {
    phase(id, undefined, usePanelHibernationStore.getState().errors[id]); operations.delete(id);
  });
  operations.set(id, task);
  return task;
}
