import { create } from 'zustand';
import type { SystemUpdatePayload } from '../types/ipc';

interface SystemState {
  cpuPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  memoryPercent: number;
  setSystemInfo: (info: SystemUpdatePayload) => void;
}

export const useSystemStore = create<SystemState>((set) => ({
  cpuPercent: 0,
  memoryUsedGb: 0,
  memoryTotalGb: 0,
  memoryPercent: 0,

  setSystemInfo: (info: SystemUpdatePayload) => {
    set({
      cpuPercent: info.cpuPercent,
      memoryUsedGb: info.memoryUsedGb,
      memoryTotalGb: info.memoryTotalGb,
      memoryPercent: info.memoryPercent,
    });
  },
}));
