import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { McpServer } from '../types/mcp';

interface McpState {
  servers: McpServer[];
  loading: boolean;
  error: string | null;
  serverStatus: Record<number, 'connected' | 'disconnected' | 'unknown'>;
  fetchServers: () => Promise<void>;
  addServer: (server: Omit<McpServer, 'id' | 'is_default' | 'enabled' | 'created_at'>) => Promise<void>;
  updateServer: (id: number, updates: Partial<McpServer>) => Promise<void>;
  removeServer: (id: number) => Promise<void>;
  toggleServer: (id: number, enabled: boolean) => Promise<void>;
  importFromClaudeDesktop: () => Promise<McpServer[]>;
  setServerStatus: (id: number, status: 'connected' | 'disconnected' | 'unknown') => void;
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,
  serverStatus: {},

  fetchServers: async () => {
    set({ loading: true, error: null });
    try {
      const servers = await invoke<McpServer[]>('mcp_list_servers');
      set({ servers, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  addServer: async (server) => {
    try {
      await invoke('mcp_add_server', {
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args,
        env: server.env,
        url: server.url,
        scope: server.scope,
      });
      await get().fetchServers();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateServer: async (id, updates) => {
    try {
      await invoke('mcp_update_server', { id, ...updates });
      await get().fetchServers();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  removeServer: async (id) => {
    try {
      await invoke('mcp_remove_server', { id });
      await get().fetchServers();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleServer: async (id, enabled) => {
    try {
      await invoke('mcp_toggle_server', { id, enabled });
      await get().fetchServers();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setServerStatus: (id, status) => {
    set((state) => ({
      serverStatus: { ...state.serverStatus, [id]: status },
    }));
  },

  importFromClaudeDesktop: async () => {
    try {
      const servers = await invoke<McpServer[]>('mcp_import_from_claude_desktop');
      return servers;
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },
}));
