import { create } from 'zustand';
import type { UsageInfo } from '../types/ipc';

interface UsageState {
  usage: Map<string, UsageInfo>;
  setUsage: (instanceId: string, info: UsageInfo) => void;
  clearUsage: (instanceId: string) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  usage: new Map(),

  setUsage: (instanceId: string, info: UsageInfo) => {
    set((state) => {
      const next = new Map(state.usage);
      next.set(instanceId, info);
      return { usage: next };
    });
  },

  clearUsage: (instanceId: string) => {
    set((state) => {
      const next = new Map(state.usage);
      next.delete(instanceId);
      return { usage: next };
    });
  },
}));
