import { create } from 'zustand';
import type { ClaudeInstance, InstanceConfig } from '../types/instance';
import { INSTANCE_COLORS } from '../types/instance';

interface InstanceState {
  instances: Map<string, ClaudeInstance>;
  addInstance: (config: InstanceConfig, name?: string) => string;
  removeInstance: (id: string) => void;
  updateInstance: (id: string, partial: Partial<ClaudeInstance>) => void;
  setStatus: (id: string, status: ClaudeInstance['status']) => void;
  setName: (id: string, name: string) => void;
  setColor: (id: string, color: string) => void;
  setModel: (id: string, model: string) => void;
  setClaudeSessionId: (id: string, sessionId: string) => void;
  getInstance: (id: string) => ClaudeInstance | undefined;
}

let colorIndex = 0;

export const useInstanceStore = create<InstanceState>((set, get) => ({
  instances: new Map(),

  addInstance: (config: InstanceConfig, name?: string) => {
    const id = crypto.randomUUID();
    const color = INSTANCE_COLORS[colorIndex % INSTANCE_COLORS.length];
    colorIndex++;

    const instance: ClaudeInstance = {
      id,
      name: name ?? `Instance ${get().instances.size + 1}`,
      color,
      config,
      status: 'starting',
    };

    set((state) => {
      const next = new Map(state.instances);
      next.set(id, instance);
      return { instances: next };
    });

    return id;
  },

  removeInstance: (id: string) => {
    set((state) => {
      const next = new Map(state.instances);
      next.delete(id);
      return { instances: next };
    });
  },

  updateInstance: (id: string, partial: Partial<ClaudeInstance>) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, ...partial });
      return { instances: next };
    });
  },

  setStatus: (id: string, status: ClaudeInstance['status']) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, status });
      return { instances: next };
    });
  },

  setName: (id: string, name: string) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, name });
      return { instances: next };
    });
  },

  setColor: (id: string, color: string) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, color });
      return { instances: next };
    });
  },

  setModel: (id: string, model: string) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, config: { ...existing.config, model } });
      return { instances: next };
    });
  },

  setClaudeSessionId: (id: string, sessionId: string) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, claudeSessionId: sessionId });
      return { instances: next };
    });
  },

  getInstance: (id: string) => {
    return get().instances.get(id);
  },
}));
