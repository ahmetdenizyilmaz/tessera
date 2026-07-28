import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest, PluginInstance } from '../types/plugin';

// ─── Module-Level Constants (React 19 + Zustand infinite loop prevention) ────

const EMPTY_REGISTRY: Map<string, PluginManifest> = new Map();
const EMPTY_INSTANCES: Map<string, PluginInstance> = new Map();

// ─── Plugin Store ────────────────────────────────────────────────────────────

interface PluginState {
  /** Available plugins discovered from subapps/ folder */
  registry: Map<string, PluginManifest>;

  /** Running plugin instances keyed by instance ID */
  instances: Map<string, PluginInstance>;

  /** Register a built-in plugin manifest (idempotent) */
  registerBuiltin: (name: string, manifest: PluginManifest) => void;

  /** Scan subapps/ directory for manifest.json files */
  scanPlugins: () => Promise<void>;

  /** Create a new plugin instance, returns the instance ID */
  createInstance: (pluginName: string) => string;

  /**
   * Recreate a plugin instance under a GIVEN id (workspace restore — the id
   * must match the persisted layout panel id). Returns false if the plugin
   * is not in the registry.
   */
  restoreInstance: (pluginName: string, id: string, title?: string) => boolean;

  /** Remove a plugin instance */
  destroyInstance: (instanceId: string) => void;

  /** Update the title of a plugin instance */
  setInstanceTitle: (id: string, title: string) => void;

  /** Update the icon of a plugin instance */
  setInstanceIcon: (id: string, icon: string) => void;

  /** Update the badge count of a plugin instance */
  setInstanceBadge: (id: string, badge: number | null) => void;

  /** Update the plugin's accent color (from plugin SDK) */
  setInstanceColor: (id: string, color: string | null) => void;

  /** Update the user override color (from context menu) */
  setUserColor: (id: string, color: string | null) => void;

  /** Get the effective color: userColor ?? accentColor ?? null */
  getEffectiveColor: (id: string) => string | null;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  registry: EMPTY_REGISTRY,
  instances: EMPTY_INSTANCES,

  registerBuiltin: (name: string, manifest: PluginManifest) => {
    set((state) => {
      if (state.registry.has(name)) return state;
      const next = new Map(state.registry);
      next.set(name, manifest);
      return { registry: next };
    });
  },

  scanPlugins: async () => {
    try {
      // TODO: Implement Rust command `scan_plugins` in src-tauri/src/
      // Expected return: Array of { name: string, manifest: PluginManifest }
      const results = await invoke<Array<{ name: string; manifest: PluginManifest }>>('scan_plugins');
      // Preserve built-in plugins, then add scanned external plugins
      const next = new Map<string, PluginManifest>();
      get().registry.forEach((m, name) => { if (m.builtin) next.set(name, m); });
      for (const entry of results) {
        next.set(entry.name, entry.manifest);
      }
      set({ registry: next });
    } catch {
      // Gracefully handle missing Rust command or scan errors.
      // Registry stays as-is (built-ins on first call, previous state on re-scan).
    }
  },

  createInstance: (pluginName: string) => {
    const manifest = get().registry.get(pluginName);
    if (!manifest) {
      console.warn(`[pluginStore] Cannot create instance: plugin "${pluginName}" not found in registry`);
      return '';
    }

    const id = `plugin-${pluginName}-${Date.now()}`;
    const instance: PluginInstance = {
      id,
      pluginName,
      iframeReady: false,
      title: manifest.defaultTitle,
      icon: manifest.icon,
      badge: null,
      accentColor: manifest.accentColor ?? null,
      userColor: null,
    };

    set((state) => {
      const next = new Map(state.instances);
      next.set(id, instance);
      return { instances: next };
    });

    return id;
  },

  restoreInstance: (pluginName: string, id: string, title?: string) => {
    const manifest = get().registry.get(pluginName);
    if (!manifest) {
      console.warn(`[pluginStore] Cannot restore instance: plugin "${pluginName}" not found in registry`);
      return false;
    }
    if (get().instances.has(id)) return true;

    const instance: PluginInstance = {
      id,
      pluginName,
      iframeReady: false,
      title: title ?? manifest.defaultTitle,
      icon: manifest.icon,
      badge: null,
      accentColor: manifest.accentColor ?? null,
      userColor: null,
    };

    set((state) => {
      const next = new Map(state.instances);
      next.set(id, instance);
      return { instances: next };
    });

    return true;
  },

  destroyInstance: (instanceId: string) => {
    set((state) => {
      const next = new Map(state.instances);
      next.delete(instanceId);
      return { instances: next };
    });
  },

  setInstanceTitle: (id: string, title: string) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      if (existing.title === title) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, title });
      return { instances: next };
    });
  },

  setInstanceIcon: (id: string, icon: string) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      if (existing.icon === icon) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, icon });
      return { instances: next };
    });
  },

  setInstanceBadge: (id: string, badge: number | null) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      if (existing.badge === badge) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, badge });
      return { instances: next };
    });
  },

  setInstanceColor: (id: string, color: string | null) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      if (existing.accentColor === color) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, accentColor: color });
      return { instances: next };
    });
  },

  setUserColor: (id: string, color: string | null) => {
    set((state) => {
      const existing = state.instances.get(id);
      if (!existing) return state;
      if (existing.userColor === color) return state;
      const next = new Map(state.instances);
      next.set(id, { ...existing, userColor: color });
      return { instances: next };
    });
  },

  getEffectiveColor: (id: string) => {
    const instance = get().instances.get(id);
    if (!instance) return null;
    return instance.userColor ?? instance.accentColor ?? null;
  },
}));
