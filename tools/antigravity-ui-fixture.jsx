// Isolated opt-in fixture: real wizard/panel/office-sidebar components, mocked IPC.
// No agy process, no sign-in, no model calls, no real workspace.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import NewSessionWizard from '../src/components/wizard/NewSessionWizard';
import { TerminalPanel } from '../src/components/terminal/TerminalPanel';
import { AntigravitySettings } from '../src/components/settings/AntigravitySettings';
import { useWizardStore } from '../src/store/wizardStore';
import { useInstanceStore } from '../src/store/instanceStore';
import { useLayoutStore } from '../src/store/layoutStore';
import { useSettingsStore } from '../src/store/settingsStore';
import { useAntigravityStore } from '../src/store/antigravityStore';
import { refreshAntigravity } from '../src/lib/antigravityBridge';
import { openNewSessionWizard } from '../src/lib/newSessionActions';
import { serializeWorkspace, deserializeWorkspace } from '../src/lib/workspaceSerializer';
import '../src/styles/global.css';
import '../src/styles/chat.css';
import '../src/styles/codex.css';
import '../src/styles/opencode.css';
import '../src/styles/antigravity.css';
import '../src/styles/mosaic.css';
import '@xterm/xterm/css/xterm.css';

window.calls = []; window.snapshots = {}; window.refresh = refreshAntigravity;
window.instances = useInstanceStore; window.layout = useLayoutStore; window.antigravity = useAntigravityStore;
window.workspace = { save: serializeWorkspace, load: deserializeWorkspace };
window.auth = { state: 'signed-in', detail: 'A saved Antigravity sign-in was found in Windows Credential Manager. Its validity is confirmed when a turn runs.' };
window.discoverFail = null; window.startFail = null;
window.mcp = { registered: false, allowed: false, added: {} };
let conversations = 0;
const touch = s => { s.rev += 1; s.revision = `fixture:${s.rev}`; };
const item = (type, extra) => ({ id: crypto.randomUUID(), type, at: Date.now(), ...extra });
// The test plays agy's part: it decides what each turn streams and how it ends.
window.agy = {
  tool(id, name, state, extra = {}) {
    const s = window.snapshots[id];
    const existing = s.items.find(i => i.type === 'tool' && i.name === name && i.state === 'active');
    if (existing) Object.assign(existing, { state, ...extra }); else s.items.push(item('tool', { name, state, ...extra }));
    touch(s);
  },
  say(id, text, state = 'active') {
    const s = window.snapshots[id];
    const existing = s.items.at(-1)?.type === 'assistant' && s.items.at(-1).state === 'active' ? s.items.at(-1) : null;
    if (existing) Object.assign(existing, { text: existing.text + text, state }); else s.items.push(item('assistant', { text, state }));
    touch(s);
  },
  finish(id, level = 'completed', usage = null, extra = {}) {
    const s = window.snapshots[id];
    s.items.filter(i => i.state === 'active').forEach(i => { i.state = level === 'completed' ? 'done' : 'interrupted'; });
    if (extra.denied) s.items.push(item('notice', { level: 'denied', text: extra.denied, error: 'jetski: a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.' }));
    if (extra.error) { s.items.push(item('notice', { level: 'error', text: extra.error })); s.error = extra.error; s.recovery = extra.recovery ?? 'retry'; }
    s.items.push(item('result', { level, text: extra.raw ?? (level === 'completed' ? 'SUCCESS' : level === 'failed' ? 'ERROR' : 'STOPPED'), usage: usage ?? undefined, durationSeconds: 3.5 }));
    if (usage) s.usage = { input: (s.usage?.input ?? 0) + usage.input, output: (s.usage?.output ?? 0) + usage.output, thinking: (s.usage?.thinking ?? 0) + usage.thinking, cacheRead: 0, total: (s.usage?.total ?? 0) + usage.total };
    s.busy = false;
    touch(s);
  },
};
mockIPC(async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'antigravity_discover') {
    if (window.discoverFail) throw window.discoverFail;
    return { path: args.executablePath || 'C:/Users/fixture/AppData/Local/agy/bin/agy.exe', version: '1.2.15', modelsError: null, auth: window.auth,
      models: [{ id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' }, { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' }, { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' }] };
  }
  if (command === 'antigravity_configure') {
    if (window.startFail && args.start) throw window.startFail;
    const existing = window.snapshots[args.id];
    if (existing && existing.busy && existing.config && JSON.stringify(existing.config) !== JSON.stringify(args.config)) throw 'Wait for the current turn to finish (or stop it) before changing this panel\'s settings.';
    const s = window.snapshots[args.id] ??= { generation: 'fixture', rev: 1, revision: 'fixture:1', configured: true, conversationId: args.conversationId ?? (args.start ? `conv-fixture-${++conversations}` : null),
      processAlive: !!args.start, busy: false, items: structuredClone(window.savedItems?.[args.config.dataId] ?? []), error: null, recovery: null, permissionMode: null, tools: null, usage: null };
    s.config = args.config; s.model = args.config.model; s.permissionMode = args.config.permission === 'skip' ? 'always-proceed' : 'request-review'; s.tools = 60;
    touch(s);
    return structuredClone(s);
  }
  if (command === 'antigravity_snapshot') {
    const s = window.snapshots[args.id];
    if (!s) throw 'Open or resume this Antigravity panel first.';
    return args.knownRevision === s.revision ? null : structuredClone(s);
  }
  if (command === 'antigravity_send') {
    const s = window.snapshots[args.id];
    if (s.busy) throw 'Antigravity is still working on the previous message. Wait for it to finish or stop the turn first.';
    s.items.push(item('user', { text: args.text })); s.busy = true; s.error = null; s.recovery = null; s.processAlive = true;
    s.conversationId ??= `conv-fixture-${++conversations}`;
    touch(s);
    return;
  }
  if (command === 'antigravity_interrupt') {
    const s = window.snapshots[args.id];
    if (s.busy) { s.items.push(item('notice', { level: 'info', text: 'Stopped. agy\'s headless mode has no in-band cancel, so Tessera ended its process; this conversation resumes with your next message.' })); window.agy.finish(args.id, 'interrupted'); s.processAlive = false; }
    return;
  }
  if (command === 'antigravity_new_conversation') {
    const s = window.snapshots[args.id];
    s.conversationId = null; s.error = null; s.recovery = null; s.usage = null;
    s.items.push(item('notice', { level: 'info', text: 'New Antigravity conversation. Messages above are kept for reference but are not in the agent\'s context.' }));
    touch(s);
    return structuredClone(s);
  }
  if (command === 'antigravity_close') {
    // Stands in for Tessera's per-panel transcript file, which outlives the process.
    const s = window.snapshots[args.id];
    if (s?.config) (window.savedItems ??= {})[s.config.dataId] = s.items;
    delete window.snapshots[args.id];
    return;
  }
  if (command === 'antigravity_terminal_spawn') {
    const s = window.snapshots[args.id];
    if (window.terminalMissing) { s.error = 'The saved Antigravity conversation conv-gone was not found on this PC, so it was not resumed.'; s.recovery = 'new_conversation'; touch(s); throw s.error; }
    s.conversationId ??= `conv-fixture-${++conversations}`; touch(s);
    // Like the real TUI, the fixture enables bracketed paste (DECSET 2004).
    setTimeout(() => void emit(`pty-data-${args.id}`, '\x1b[?2004hNative Antigravity terminal fixture\r\n'), 30);
    return { conversationId: s.conversationId, warning: null };
  }
  if (command === 'antigravity_mcp_status') return {
    servers: [...Object.keys(window.mcp.added).map(name => ({ name, target: 'C:/tools/python.exe', disabled: false, tessera: false })), { name: 'my-own-server', target: 'npx', disabled: false, tessera: false }],
    candidates: [{ name: 'desktop-control', source: 'Claude Code', target: 'C:/tools/python.exe', problem: null, added: !!window.mcp.added['desktop-control'] },
      { name: 'old-events', source: 'Tessera MCP manager', target: 'https://example.com/sse', problem: 'uses the legacy SSE transport, which agy does not support.', added: false }],
    panelTools: { name: 'tessera-panels', registered: window.mcp.registered, current: window.mcp.registered, allowedInChat: window.mcp.allowed,
      rules: ['mcp(tessera-panels/list_panels)', 'mcp(tessera-panels/send_to_panel)', 'mcp(tessera-panels/read_panel)'] },
  };
  if (command === 'antigravity_mcp_panel_tools') { window.mcp.registered = args.enable; window.mcp.allowed = args.enable && args.allowInChat; return; }
  if (command === 'antigravity_mcp_import') { window.mcp.added[args.name] = true; return; }
  if (command === 'antigravity_mcp_remove') { delete window.mcp.added[args.name]; return; }
  if (command === 'pty_capabilities') return { windowsPty: { backend: 'conpty', buildNumber: 26200 } };
  if (command === 'pty_read_buffer') return '';
  if (command === 'plugin:dialog|open') return 'C:/fixture/project';
  return [];
}, { shouldMockEvents: true });
useSettingsStore.getState().updateSettings({ lastCwd: 'C:/fixture/project', lastSessionPreset: null });
openNewSessionWizard();
function App() {
  const [settings, showSettings] = useState(false);
  window.showSettings = showSettings;
  const instances = useInstanceStore(s => s.instances);
  const tabs = useLayoutStore(s => s.tabOrder);
  const kinds = useLayoutStore(s => s.widgetKinds);
  const wizard = tabs.find(id => kinds[id] === 'new-session');
  const panels = tabs.filter(id => instances.has(id));
  return <div style={{ height: '100vh', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div><button className="btn btn-secondary" onClick={() => { openNewSessionWizard(); useWizardStore.getState().reset(); }}>New panel</button></div>
    {settings ? <div style={{ maxWidth: 620, overflowY: 'auto' }}><AntigravitySettings /></div> : <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8 }}>
      {panels.map(id => <div key={id} data-panel={instances.get(id).name} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><TerminalPanel instanceId={id} /></div>)}
      {wizard && <div style={{ flex: 1, minWidth: 0, maxWidth: 760, overflowY: 'auto' }}><NewSessionWizard instanceId={wizard} /></div>}
    </div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
