import type { PluginManifest } from '../types/plugin';
import notes from '../../examples/html-apps/notes/manifest.json';
import timer from '../../examples/html-apps/timer/manifest.json';
import clock from '../../examples/html-apps/clock/manifest.json';
import calculator from '../../examples/html-apps/calculator/manifest.json';
import memory from '../../examples/html-apps/memory/manifest.json';

export const NOTES_APP = 'html-tessera.quick-notes';
export function canonicalAppName(name: string): string {
  return name === 'notepad' ? NOTES_APP : name === 'timer' ? 'html-tessera.timer' : name;
}
export const BUNDLED_APPS: PluginManifest[] = [notes,timer,clock,calculator,memory].map(m => ({
  name: `html-${m.id}`, defaultTitle: m.name, description: m.description,
  version: m.version, entry: m.entry, icon: m.icon, htmlPlugin: true, bundled: true,
  browserSite: `html-${m.id}`, permissions: { network: [], panels: [] }, enabled: true,
}));
