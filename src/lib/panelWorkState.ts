import { useInstanceStore } from '../store/instanceStore';
import { useCodexStore } from '../store/codexStore';
import { useOpenCodeStore } from '../store/opencodeStore';
import { useAntigravityStore } from '../store/antigravityStore';
import { useChatStore } from '../store/chatStore';
import type { WorkerActivity } from '../types/office';

// Fresh observations only. The office's persisted animation state is not proof
// that an agent is idle after a restart or a failed activity poll.
const recorded = new Map<string, { activity: WorkerActivity; checkedAt: number }>();
export function recordPanelWorkState(id: string, activity: WorkerActivity, checkedAt: number) {
  recorded.set(id, { activity, checkedAt });
}
export function forgetPanelWorkState(id: string) { recorded.delete(id); }
export function panelWorkState(id: string): { busy: boolean; knownIdle: boolean } {
  const inst = useInstanceStore.getState().instances.get(id);
  if (!inst) return { busy: false, knownIdle: false };
  const provider = inst.config.agentProvider ?? 'claude';
  if (provider === 'codex') {
    const s = useCodexStore.getState().sessions[id];
    return { busy: !!(s?.busy || s?.requests.length), knownIdle: !!s?.connected };
  }
  if (provider === 'opencode') {
    const s = useOpenCodeStore.getState().sessions[id];
    return { busy: !!s && (s.status.type !== 'idle' || s.permissions.length + s.questions.length > 0), knownIdle: !!s?.connected };
  }
  if (provider === 'antigravity') {
    const s = useAntigravityStore.getState().sessions[id];
    return { busy: !!s?.busy, knownIdle: inst.config.panelView !== 'terminal' && !!s?.configured };
  }
  if (inst.config.panelView !== 'terminal') {
    const s = useChatStore.getState().sessions.get(id);
    return { busy: !!(s?.isStreaming || s?.controlRequests.length), knownIdle: !!s };
  }
  const observation = recorded.get(id);
  if (!observation) return { busy: false, knownIdle: false };
  return { busy: !['idle', 'error', 'unknown'].includes(observation.activity),
    knownIdle: performance.now() - observation.checkedAt <= 20_000 && ['idle', 'error'].includes(observation.activity) };
}
