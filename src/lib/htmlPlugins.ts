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

let migratingNotes: Promise<void> | undefined;
/** The old same-origin iframe saved per-panel notebooks in host localStorage. */
export function migrateLegacyNotes(): Promise<void> {
  return migratingNotes ??= (async () => {
    const notebooks: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('plugin-notepad-')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const notes: unknown = JSON.parse(raw);
        if (Array.isArray(notes) && notes.every(n => n && typeof n.title === 'string' && typeof n.content === 'string')) notebooks[key] = notes;
      } catch { console.warn('An unreadable legacy notebook was kept:', key); }
    }
    await invoke('html_plugin_migrate_notes', { notebooks });
  })().catch(error => { migratingNotes = undefined; throw error; });
}
