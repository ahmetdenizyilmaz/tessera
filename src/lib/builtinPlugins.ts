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

const MESSENGER_MANIFEST: PluginManifest = {
  name: 'messenger',
  version: '1.0.0',
  description: 'Test inter-plugin messaging (direct & broadcast)',
  entry: 'index.html',
  icon: 'MessageSquare',
  defaultTitle: 'Messenger',
  builtin: true,
  accentColor: '#a6e3a1',
};

const DEVSTUDIO_MANIFEST: PluginManifest = {
  name: 'devstudio',
  version: '1.0.0',
  description: 'Autonomous multi-agent development studio',
  entry: 'index.html',
  icon: 'Code2',
  defaultTitle: 'DevStudio',
  builtin: true,
  accentColor: '#f97316',
};

export function registerBuiltins(): void {
  const { registerBuiltin } = usePluginStore.getState();
  registerBuiltin('notepad', NOTEPAD_MANIFEST);
  registerBuiltin('timer', TIMER_MANIFEST);
  registerBuiltin('messenger', MESSENGER_MANIFEST);
  registerBuiltin('devstudio', DEVSTUDIO_MANIFEST);
}
