// Isolated opt-in fixture: no native processes, credentials, or real workspace.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import NewSessionWizard from '../src/components/wizard/NewSessionWizard';
import { TerminalPanel } from '../src/components/terminal/TerminalPanel';
import { OpenCodeSettings } from '../src/components/settings/OpenCodeSettings';
import { useWizardStore } from '../src/store/wizardStore';
import { useInstanceStore } from '../src/store/instanceStore';
import { useLayoutStore } from '../src/store/layoutStore';
import { useSettingsStore } from '../src/store/settingsStore';
import { refreshOpenCode } from '../src/lib/opencodeBridge';
import { DEFAULT_OPENCODE_OPTIONS } from '../src/lib/opencodeConfig';
import '../src/styles/global.css';
import '../src/styles/chat.css';
import '../src/styles/codex.css';
import '../src/styles/opencode.css';
import '../src/styles/mosaic.css';
import '@xterm/xterm/css/xterm.css';
window.calls = []; window.snapshots = {}; window.refresh = refreshOpenCode;
window.instances = useInstanceStore; window.layout = useLayoutStore;
let keyPresent = false;
mockIPC(async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'llm_get_api_key') return keyPresent ? 'fixture-key' : null;
  if (command === 'llm_set_api_key') { keyPresent = true; return; }
  if (command === 'opencode_models') return ['fixture-coder', 'fixture-other'];
  if (command === 'opencode_discover') return { version: '1.18.32', path: 'C:/fixture/opencode.exe' };
  if (command === 'opencode_configure') {
    window.snapshots[args.id] ??= { generation: 'fixture', sessionId: args.sessionId ?? 'ses_fixture', connected: true, model: args.config.model, agent: args.config.agent, status: { type: 'idle' }, messages: [], permissions: [], questions: [] };
    return structuredClone(window.snapshots[args.id]);
  }
  if (command === 'opencode_snapshot') return structuredClone(window.snapshots[args.id]);
  if (command === 'opencode_send') {
    const s = window.snapshots[args.id];
    s.messages.push({ info: { id: crypto.randomUUID(), role: 'user' }, parts: [{ id: crypto.randomUUID(), type: 'text', text: args.text }] });
    s.messages.push({ info: { id: crypto.randomUUID(), role: 'assistant' }, parts: [{ id: crypto.randomUUID(), type: 'text', text: 'OpenCode fixture reply' }, { id: crypto.randomUUID(), type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'README.md' }, output: 'Fixture document' } }] });
    return;
  }
  if (command === 'opencode_respond') { const s = window.snapshots[args.id]; s.permissions = s.permissions.filter(p => p.id !== args.requestId); s.questions = s.questions.filter(p => p.id !== args.requestId); return; }
  if (command === 'pty_capabilities') return { windowsPty: { backend: 'conpty', buildNumber: 26200 } };
  if (command === 'opencode_terminal_spawn') { setTimeout(() => void emit(`pty-output-${args.id}`, 'Native OpenCode terminal fixture\r\n'), 30); return; }
  if (command === 'pty_read_buffer') return '';
  if (command === 'plugin:dialog|open') return 'C:/fixture/project';
  return [];
}, { shouldMockEvents: true });
useSettingsStore.getState().updateSettings({ openCodeDefaults: { ...DEFAULT_OPENCODE_OPTIONS, provider: 'ollama', model: 'fixture-coder' }, lastCwd: 'C:/fixture/project' });
const wizard = useLayoutStore.getState().addWidgetPanel('new-session');
useWizardStore.getState().reset();
function App() {
  const [settings, showSettings] = useState(false);
  window.showSettings = showSettings;
  const instances = useInstanceStore(s => s.instances);
  const tabs = useLayoutStore(s => s.tabOrder);
  const id = tabs.find(id => instances.has(id));
  return <div style={{ height: '100vh', padding: 12, display: 'flex', flexDirection: 'column' }}>
    {settings ? <div style={{ maxWidth: 620, overflowY: 'auto' }}><OpenCodeSettings /></div> : id ? <TerminalPanel instanceId={id} /> : <div style={{ maxWidth: 760, overflowY: 'auto' }}><NewSessionWizard instanceId={wizard} /></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
