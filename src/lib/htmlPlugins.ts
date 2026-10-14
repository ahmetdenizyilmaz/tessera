import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest } from '../types/plugin';

const CACHE_KEY = 'tessera-html-apps';
// Startup uses a display-only cache so workspace restore can recreate app
// panels synchronously. The native runtime still validates every installed app.
export function loadHtmlApps(): PluginManifest[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((m): m is PluginManifest => !!m && m.htmlPlugin === true && typeof m.name === 'string'
      && /^html-[a-z0-9][a-z0-9.-]{0,79}$/.test(m.name) && m.browserSite === m.name
      && typeof m.defaultTitle === 'string' && typeof m.icon === 'string' && !m.builtin && !m.customWebApp);
  } catch { return []; }
}

export function saveHtmlApps(registry: Map<string, PluginManifest>): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify([...registry.values()].filter(m => m.htmlPlugin)));
}

export async function setHtmlAppEnabled(plugin: string, enabled: boolean): Promise<void> {
  await invoke('html_plugin_set_enabled', { plugin, enabled });
}
