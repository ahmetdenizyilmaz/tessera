import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Agent, AgentRun } from '../types/agent';

interface AgentState {
  agents: Agent[];
  runs: Map<number, AgentRun[]>;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  createAgent: (agent: { name: string; description: string; system_prompt: string; model: string; tools?: string; mcp_servers?: string }) => Promise<number>;
  updateAgent: (id: number, updates: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: number) => Promise<void>;
  fetchRuns: (agentId: number) => Promise<void>;
  exportAgent: (id: number) => string | null;
  importAgent: (jsonString: string) => Promise<number>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  runs: new Map(),
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await invoke<Agent[]>('agent_list');
      set({ agents, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createAgent: async (agent) => {
    try {
      const id = await invoke<number>('agent_create', agent);
      await get().fetchAgents();
      return id;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updateAgent: async (id, updates) => {
    try {
      await invoke('agent_update', { id, ...updates });
      await get().fetchAgents();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteAgent: async (id) => {
    try {
      await invoke('agent_delete', { id });
      await get().fetchAgents();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchRuns: async (agentId) => {
    try {
      const runs = await invoke<AgentRun[]>('agent_list_runs', { agentId });
      set((state) => {
        const next = new Map(state.runs);
        next.set(agentId, runs);
        return { runs: next };
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  exportAgent: (id) => {
    const agent = get().agents.find((a) => a.id === id);
    if (!agent) return null;
    const { id: _id, created_at: _c, updated_at: _u, ...exportData } = agent;
    return JSON.stringify(exportData, null, 2);
  },

  importAgent: async (jsonString) => {
    const parsed = JSON.parse(jsonString);
    return get().createAgent({
      name: parsed.name ?? 'Imported Agent',
      description: parsed.description ?? '',
      system_prompt: parsed.system_prompt ?? '',
      model: parsed.model ?? 'claude-sonnet-4-6',
      tools: parsed.tools ?? '[]',
      mcp_servers: parsed.mcp_servers ?? '[]',
    });
  },
}));
