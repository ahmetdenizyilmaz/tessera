import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePanelHibernationStore, isPanelSuspended } from '../store/panelHibernationStore';
import { canAutoHibernate, elapsedAppTime, HIBERNATION_TICK_MS, normalizeHibernation, supportsHibernation } from '../lib/panelHibernationPolicy';
import { forgetPanelActivity, hasTerminalDraft, isPanelViewed, panelActivityRevision } from '../lib/panelActivityClock';
import { forgetPanelWorkState, panelWorkState } from '../lib/panelWorkState';
import { hasPanelDraft } from './usePanelDraft';
import { hibernatePanel } from '../lib/panelHibernation';

export function usePanelHibernation() {
  useEffect(() => {
    let previous = performance.now();
    const seen = new Map<string, number>();
    const tick = () => {
      const now = performance.now(), elapsed = elapsedAppTime(previous, now);
      previous = now;
      const minutes = useSettingsStore.getState().settings.panelHibernationMinutes;
      const { instances } = useInstanceStore.getState();
      const next = new Map(instances);
      const candidates: string[] = [];
      let changed = false;
      for (const [id, inst] of instances) {
        const type = useLayoutStore.getState().panelTypes[id];
        if (!supportsHibernation(inst) || ['remote', 'computer', 'widget', 'plugin', 'group'].includes(type)) continue;
        const revision = panelActivityRevision(id);
        const touched = revision !== (seen.get(id) ?? 0);
        seen.set(id, revision);
        if (isPanelSuspended(id)) continue;
        const work = panelWorkState(id), focused = isPanelViewed(id);
        const hasDraft = hasPanelDraft(id) || hasTerminalDraft(id);
        const saved = normalizeHibernation(inst.hibernation);
        const idleMs = focused || touched || work.busy || hasDraft || inst.status === 'starting' ? 0 : saved.idleMs + elapsed;
        if (idleMs !== saved.idleMs) {
          next.set(id, { ...inst, hibernation: { ...saved, idleMs } }); changed = true;
        }
        if (canAutoHibernate({ enabledMinutes: minutes, idleMs, focused, hasDraft, ...work,
          starting: inst.status === 'starting', sleeping: saved.sleeping })) candidates.push(id);
      }
      if (changed) useInstanceStore.setState({ instances: next });
      for (const id of candidates) void hibernatePanel(id, true).catch(() => {
        // A busy race or disk error must not hammer the native service.
        const inst = useInstanceStore.getState().instances.get(id);
        if (inst && !inst.hibernation?.sleeping) useInstanceStore.getState().updateInstance(id, {
          hibernation: { ...normalizeHibernation(inst.hibernation), idleMs: 0 },
        });
      });
    };
    const timer = setInterval(tick, HIBERNATION_TICK_MS);
    const unsubscribe = useInstanceStore.subscribe((state, old) => {
      const restored = [...state.instances.values()].filter(inst => inst.hibernation?.sleeping && !old.instances.has(inst.id)).map(inst => inst.id);
      if (restored.length) void invoke('panel_hibernation_restore', { ids: restored }).catch(() => {});
      for (const id of old.instances.keys()) {
        if (state.instances.has(id)) continue;
        seen.delete(id); forgetPanelActivity(id); forgetPanelWorkState(id);
        // Also forget native guards; this command cannot start a process.
        void invoke('panel_wake', { id }).catch(() => {});
        usePanelHibernationStore.setState(s => {
          const previews = { ...s.previews }, phases = { ...s.phases }, errors = { ...s.errors };
          delete previews[id]; delete phases[id]; delete errors[id]; return { previews, phases, errors };
        });
      }
    });
    return () => { clearInterval(timer); unsubscribe(); };
  }, []);
}
