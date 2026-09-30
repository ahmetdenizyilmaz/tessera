// Synthetic sessions, real office and stores. No agent or model calls.
import React, { useState, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { OfficeView } from '../src/components/office/OfficeView';
import { useWorkerActivity } from '../src/hooks/useWorkerActivity';
import { useOfficeGameStore } from '../src/store/officeGameStore';
import { useInstanceStore } from '../src/store/instanceStore';
import { useChatStore } from '../src/store/chatStore';
import { useCodexStore } from '../src/store/codexStore';
import { useOpenCodeStore } from '../src/store/opencodeStore';
import { useLlmChatStore } from '../src/store/llmChatStore';
import { useLayoutStore } from '../src/store/layoutStore';
import '../src/styles/global.css';
import '../src/styles/chat.css';
import '../src/styles/codex.css';
mockWindows('main');
window.office = useOfficeGameStore;
window.instances = useInstanceStore;
window.codex = useCodexStore;
window.chat = useChatStore;
window.opencode = useOpenCodeStore;
window.llm = useLlmChatStore;
window.officeHistory = {};
window.officeHistoryDelay = 0;
window.officeCalls = [];
window.officeFail = false;
const start = useOfficeGameStore.getState().startedAt;
const makeRecord = (id, actorId, name, provider, tools) => ({ id, kind: 'turn', actor: { id: actorId, name, provider, model: provider, device: null }, startedAt: start + 100, updatedAt: Date.now(), prompt: 'Completed the workspace improvements', response: 'Done', status: 'completed', tools, usage: null, sessionId: id, parentId: null, target: null, origin: 'user', usageNote: null });
window.officeRecords = [makeRecord('done-a', 'architect', 'Backend architect', 'claude', ['Read', 'Edit', 'Bash']), makeRecord('done-b', 'tester', 'Test engineer', 'codex', ['Bash', 'Edit']), makeRecord('done-c', 'research', 'Research assistant', 'codex', ['WebSearch'])];
mockIPC(async (command, args) => {
  window.officeCalls.push({ command, args });
  if (command === 'session_load_history') {
    const messages = window.officeHistory[args.sessionId] ?? [];
    await new Promise(resolve => setTimeout(resolve, window.officeHistoryDelay));
    if (window.officeHistoryFail) throw new Error('History temporarily unavailable');
    return messages;
  }
  if (command === 'codex_read_thread') return { thread: { id: args.threadId, turns: [{ id: 'saved', items: [{ id: 'saved-answer', type: 'agentMessage', text: 'Saved Codex thread restored in office.' }] }] } };
  if (command === 'activity_list') {
    if (window.officeFail) throw new Error('Test connection unavailable');
    const all = window.officeRecords.filter(r => r.startedAt >= args.since && (!args.before || r.startedAt < args.before.at || (r.startedAt === args.before.at && r.id < args.before.id))).sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
    const records = all.slice(0, args.limit);
    for (const id of args.refreshIds ?? []) { const r = window.officeRecords.find(r => r.id === id); if (r && !records.some(x => x.id === id)) records.push(r); }
    return { records, hasMore: all.length > args.limit, health: { error: null, lastScan: Date.now() } };
  }
  return null;
}, { shouldMockEvents: true });
for (const [id, name, provider, model] of [['architect', 'Backend architect', 'claude', 'Claude Sonnet'], ['tester', 'Test engineer', 'codex', 'Codex'], ['research', 'Research assistant', 'codex', 'Codex'], ['designer', 'Interface designer', 'claude', 'Claude Opus'], ['reviewer', 'Code reviewer', 'claude', 'Claude Sonnet']]) {
  useInstanceStore.setState(s => ({ instances: new Map([...s.instances, [id, { id, name, status: 'running', color: '#9bb7ac', config: { agentProvider: provider, panelView: 'chat', cwd: 'C:\\fixture', model, systemPrompt: '', allowedTools: [], maxBudget: 0, agentMode: true, dangerouslySkipPermissions: false, permissionMode: 'default' } }]]) }));
  useLayoutStore.getState().addPanel(id);
  if (provider === 'claude') {
    useChatStore.getState().initSession(id);
    useChatStore.getState().addUserMessage(id, id === 'architect' ? 'Refactor the connection manager and read the existing retry behavior.' : id === 'designer' ? 'Polish the office layout and update the furniture controls.' : 'Review the permissions and ask before making the final change.');
    useChatStore.getState().setStreaming(id, true);
    useChatStore.getState().processEvent(id, { type: 'assistant', message: { id: `msg-${id}`, role: 'assistant', model, content: [{ type: 'tool_use', id: 'tool', name: id === 'architect' ? 'Read' : 'Edit', input: {} }] } });
    if (id === 'reviewer') useChatStore.getState().processEvent(id, { type: 'control_request', request_id: 'approve', request: { subtype: 'can_use_tool', tool_name: 'Edit' } });
  } else {
    useCodexStore.getState().hydrate(id, { generation: 'fixture', threadId: id, thread: { id, cwd: '', updatedAt: 0 }, events: [], requests: [], busy: true, alive: true });
    useCodexStore.getState().receive({ id, generation: 'fixture', sequence: 1, message: { method: 'item/started', params: { threadId: id, item: { id: 'question', type: 'userMessage', content: [{ type: 'text', text: id === 'tester' ? 'Run the regression suite and investigate failing tests.' : 'Research the best approach for reconnecting local computers.' }] } } } });
    useCodexStore.getState().receive({ id, generation: 'fixture', sequence: 2, message: { method: 'item/started', params: { threadId: id, item: { id: 'work', type: id === 'tester' ? 'commandExecution' : 'webSearch', command: 'npm test' } } } });
  }
}
function Fixture() {
  useWorkerActivity();
  const [visible, setVisible] = useState(true);
  return <div style={{ height: '100vh', display: 'flex' }}>{visible ? <OfficeView onBack={() => setVisible(false)} /> : <button onClick={() => setVisible(true)}>Return to office</button>}</div>;
}
if (location.search.includes('empty')) useInstanceStore.setState({ instances: new Map() });
document.documentElement.setAttribute('data-theme', 'dark');
document.body.style.margin = '0';
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
