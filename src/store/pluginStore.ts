import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest, PluginInstance } from '../types/plugin';
import { loadWebApps, saveWebApps, webAppManifest, webAppIcon, validWebAppIcon, restoreBrowserIcon, saveBrowserIcon, type WebAppInput } from '../lib/webApps';
import { fetchWebsiteIcon } from '../lib/websiteIcon';
import { loadRemovedPlugins, saveRemovedPlugins } from '../lib/pluginAvailability';
import { loadHtmlApps, saveHtmlApps } from '../lib/htmlPlugins';

// ─── Module-Level Constants (React 19 + Zustand infinite loop prevention) ────

const EMPTY_REGISTRY: Map<string, PluginManifest> = new Map([...loadWebApps(), ...loadHtmlApps()].map(m=>[m.name,m]));
const EMPTY_INSTANCES: Map<string, PluginInstance> = new Map();

// ─── Plugin Store ────────────────────────────────────────────────────────────

interface PluginState {
  /** Available plugins discovered from subapps/ folder */
  registry: Map<string, PluginManifest>;

  /** Running plugin instances keyed by instance ID */
  instances: Map<string, PluginInstance>;

  /** Removed from launch menus; definitions/data remain available for restore. */
  removedPlugins: Set<string>;
  setPluginRemoved: (name: string, removed: boolean) => void;

  /** Register a built-in plugin manifest (idempotent) */
  registerBuiltin: (name: string, manifest: PluginManifest) => void;
  registerHtmlApp: (manifest: PluginManifest) => void;
  addWebApp: (input:WebAppInput) => string;
  restoreWebApp: (manifest:PluginManifest) => void;
  setWebAppIcon: (name: string, icon: string) => void;
  refreshWebAppIcon: (name: string, force?: boolean) => Promise<void>;

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
  setBrowserUrl: (id: string, url: string) => void;

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
  removedPlugins: loadRemovedPlugins(),
  setPluginRemoved: (name, removed) => {
    if (!get().registry.has(name)) return;
    const removedPlugins = new Set(get().removedPlugins);
    if (removed) removedPlugins.add(name); else removedPlugins.delete(name);
    // Save first: a storage failure must not remove a shortcut or close panels.
    saveRemovedPlugins(removedPlugins);
    set({ removedPlugins });
  },
  addWebApp: input => {
    const manifest=webAppManifest(input), registry=new Map(get().registry);
    registry.set(manifest.name,manifest);
    saveWebApps(registry);
    set({registry});
    void get().refreshWebAppIcon(manifest.name);
    return manifest.name;
  },
  restoreWebApp: saved => {
    if(typeof saved.name!=='string')throw new Error('A saved web app must have a stable identity.');
    if(get().registry.has(saved.name))return;
    const manifest=webAppManifest({name:saved.defaultTitle,url:saved.homeUrl??'',icon:saved.icon ?? '',favicon:saved.favicon},saved.name);
    const registry=new Map(get().registry);registry.set(manifest.name,manifest);
    saveWebApps(registry);set({registry});
  },
  setWebAppIcon: (name, icon) => {
    const current = get().registry.get(name);
    if (!current?.browserSite || !current.homeUrl || !validWebAppIcon(icon)) return;
    const manifest = { ...current, icon };
    const registry = new Map(get().registry).set(name, manifest);
    if (manifest.customWebApp) saveWebApps(registry);
    else saveBrowserIcon(manifest);
    const instances = new Map(get().instances);
    for (const [id, instance] of instances) if (instance.pluginName === name) instances.set(id, { ...instance, icon: webAppIcon(manifest) });
    set({ registry, instances });
    void get().refreshWebAppIcon(name);
  },
  refreshWebAppIcon: async (name, force = false) => {
    const original = get().registry.get(name);
    if (!original?.browserSite || original.icon !== '' || !original.homeUrl || original.favicon && !force) return;
    try {
      const favicon = await fetchWebsiteIcon(original.homeUrl, force);
      const current = get().registry.get(name);
      if (!favicon || !current || current.icon !== '' || current.homeUrl !== original.homeUrl) return;
      const manifest = { ...current, favicon }, registry = new Map(get().registry).set(name, manifest);
      if (manifest.customWebApp) saveWebApps(registry);
      else saveBrowserIcon(manifest);
      const instances = new Map(get().instances);
      for (const [id, instance] of instances) if (instance.pluginName === name) instances.set(id, { ...instance, icon: favicon });
      set({ registry, instances });
    } catch { /* Icon discovery must never prevent opening a website panel. */ }
  },

  registerBuiltin: (name: string, manifest: PluginManifest) => {
    set((state) => {
      if (state.registry.has(name)) return state;
      const next = new Map(state.registry);
      next.set(name, restoreBrowserIcon(manifest));
      return { registry: next };
    });
  },

  registerHtmlApp: manifest => {
    const registry = new Map(get().registry).set(manifest.name, manifest);
    saveHtmlApps(registry);
    set({registry});
    get().setPluginRemoved(manifest.name, false);
  },

  scanPlugins: async () => {
    try {
      const results = await invoke<Array<{ name: string; manifest: PluginManifest }>>('scan_plugins');
      // Preserve built-in plugins, then add scanned external plugins
      const next = new Map<string, PluginManifest>();
      get().registry.forEach((m, name) => { if (m.builtin || m.customWebApp) next.set(name, m); });
      for (const entry of results) {
        if(!next.has(entry.name))next.set(entry.name, restoreBrowserIcon(entry.manifest));
      }
      saveHtmlApps(next);
      const removedPlugins = new Set(get().removedPlugins);
      for (const { name, manifest } of results) if (manifest.htmlPlugin) {
        if (manifest.enabled === false) removedPlugins.add(name); else removedPlugins.delete(name);
      }
      saveRemovedPlugins(removedPlugins);
      set({ registry: next, removedPlugins });
    } catch {
      // Gracefully handle missing Rust command or scan errors.
      // Registry stays as-is (built-ins on first call, previous state on re-scan).
    }
  },

  createInstance: (pluginName: string) => {
    if (get().removedPlugins.has(pluginName)) return '';
    const manifest = get().registry.get(pluginName);
    if (!manifest) {
      console.warn(`[pluginStore] Cannot create instance: plugin "${pluginName}" not found in registry`);
      return '';
    }

    const id = `plugin-${crypto.randomUUID()}`;
    const instance: PluginInstance = {
      id,
      pluginName,
      iframeReady: false,
      title: manifest.defaultTitle,
      icon: webAppIcon(manifest),
      badge: null,
      accentColor: manifest.accentColor ?? null,
      userColor: null,
    };

    set((state) => {
      const next = new Map(state.instances);
      next.set(id, instance);
      return { instances: next };
    });

    void get().refreshWebAppIcon(pluginName);
    return id;
  },

  restoreInstance: (pluginName: string, id: string, title?: string) => {
    if (get().removedPlugins.has(pluginName)) return false;
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
      icon: webAppIcon(manifest),
      badge: null,
      accentColor: manifest.accentColor ?? null,
      userColor: null,
    };

    set((state) => {
      const next = new Map(state.instances);
      next.set(id, instance);
      return { instances: next };
    });

    void get().refreshWebAppIcon(pluginName);
    return true;
  },

  destroyInstance: (instanceId: string) => {
    set((state) => {
      const next = new Map(state.instances);
      next.delete(instanceId);
      return { instances: next };
    });
  },

  setBrowserUrl: (id, url) => {
    set((state) => {
      const instance = state.instances.get(id);
      if (!instance || instance.browserUrl === url) return state;
      const instances = new Map(state.instances);
      instances.set(id, { ...instance, browserUrl: url });
      return { instances };
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
