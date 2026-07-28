import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Checkpoint } from '../types/checkpoint';

interface CheckpointState {
  checkpoints: Map<string, Checkpoint[]>; // instanceId -> checkpoints
  activeBranch: Map<string, string>; // instanceId -> branch name
  autoCheckpoint: boolean;
  loading: boolean;
  error: string | null;
  fetchCheckpoints: (instanceId: string) => Promise<void>;
  createCheckpoint: (instanceId: string, sessionId: string, label: string, messagesSnapshot: string, branchName?: string, parentId?: number) => Promise<number>;
  deleteCheckpoint: (checkpointId: number, instanceId: string) => Promise<void>;
  branchFromCheckpoint: (checkpointId: number, newBranchName: string, instanceId: string) => Promise<number>;
  getCheckpoint: (checkpointId: number) => Promise<Checkpoint>;
  restoreCheckpoint: (checkpointId: number) => Promise<Checkpoint>;
  diffCheckpoints: (idA: number, idB: number) => Promise<DiffResult>;
  setActiveBranch: (instanceId: string, branch: string) => void;
  setAutoCheckpoint: (enabled: boolean) => void;
}

export interface DiffResult {
  added: unknown[];
  removed: unknown[];
  modified: Array<{ index: number; before: unknown; after: unknown }>;
}

export const useCheckpointStore = create<CheckpointState>((set, get) => ({
  checkpoints: new Map(),
  activeBranch: new Map(),
  autoCheckpoint: true,
  loading: false,
  error: null,

  fetchCheckpoints: async (instanceId) => {
    set({ loading: true });
    try {
      const checkpoints = await invoke<Checkpoint[]>('checkpoint_list', { instanceId });
      set((state) => {
        const next = new Map(state.checkpoints);
        next.set(instanceId, checkpoints);
        return { checkpoints: next, loading: false };
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createCheckpoint: async (instanceId, sessionId, label, messagesSnapshot, branchName, parentId) => {
    try {
      const id = await invoke<number>('checkpoint_create', {
        instanceId, sessionId, label, messagesSnapshot, branchName, parentId,
      });
      await get().fetchCheckpoints(instanceId);
      return id;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteCheckpoint: async (checkpointId, instanceId) => {
    try {
      await invoke('checkpoint_delete', { checkpointId });
      await get().fetchCheckpoints(instanceId);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  branchFromCheckpoint: async (checkpointId, newBranchName, instanceId) => {
    try {
      const id = await invoke<number>('checkpoint_branch', { checkpointId, newBranchName });
      await get().fetchCheckpoints(instanceId);
      return id;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  getCheckpoint: async (checkpointId) => {
    return invoke<Checkpoint>('checkpoint_get', { checkpointId });
  },

  restoreCheckpoint: async (checkpointId) => {
    return invoke<Checkpoint>('checkpoint_restore', { checkpointId });
  },

  diffCheckpoints: async (idA, idB) => {
    return invoke<DiffResult>('checkpoint_diff', { idA, idB });
  },

  setActiveBranch: (instanceId, branch) => {
    set((state) => {
      const next = new Map(state.activeBranch);
      next.set(instanceId, branch);
      return { activeBranch: next };
    });
  },

  setAutoCheckpoint: (enabled) => {
    set({ autoCheckpoint: enabled });
  },
}));
