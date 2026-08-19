import type { PluginManifest } from '../types/plugin';
import { usePluginStore } from '../store/pluginStore';

const NOTEPAD_MANIFEST: PluginManifest = {
  name: 'notepad',
  version: '1.0.0',
  description: 'A multi-note notepad with sidebar navigation',
  entry: 'index.html',
  icon: 'FileText',
  defaultTitle: 'Notepad',
  builtin: true,
  accentColor: '#f59e0b',
};

const TIMER_MANIFEST: PluginManifest = {
  name: 'timer',
  version: '1.0.0',
  description: 'Countdown and stopwatch timer',
  entry: 'index.html',
  icon: 'Clock',
  defaultTitle: 'Timer',
  builtin: true,
  accentColor: '#3b82f6',
};

export function registerBuiltins(): void {
  const { registerBuiltin } = usePluginStore.getState();
  registerBuiltin('notepad', NOTEPAD_MANIFEST);
  registerBuiltin('timer', TIMER_MANIFEST);
}
