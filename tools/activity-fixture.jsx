// Browser validation with synthetic activity. No model calls or user transcripts.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import ActivityView from '../src/components/activity/ActivityView';
import '../src/styles/global.css';
mockWindows('main');
const claude = { id: 'claude-backend', name: 'Backend architect', provider: 'claude', model: 'Claude Sonnet', device: null };
const codex = { id: 'codex-tests', name: 'Test engineer', provider: 'codex', model: 'Codex', device: null };
const second = { id: 'claude-review', name: 'Code review', provider: 'claude', model: 'Claude Opus', device: null };
const start = Date.now() - 180000;
const record = (id, actor, at, prompt, response, usage) => ({ id, actor, startedAt: start + at, updatedAt: start + at + 1000, prompt, response,
  usage: usage && { input: usage[0], output: usage[1], cacheRead: usage[2], cacheWrite: usage[3] ?? 0, reasoning: usage[4] ?? 0 },
  sessionId: 'session-' + actor.id, kind: 'turn', status: 'completed', parentId: null, target: null, usageNote: null, origin: 'user' });
window.activityRecords = [
  record('question', claude, 1000, 'Design a reliable reconnect flow for local computers.', 'I traced the connection state and proposed a retry flow that preserves the workspace.', [18000, 12000, 90000]),
  record('testing', codex, 30000, 'Add regression tests for the reconnect flow.', 'The tests now cover hidden groups, nested panels, and failed connection attempts.', [9000, 11000, 30000, 0, 4000]),
  { ...record('handoff:a', codex, 45000, 'Please review whether we can lose a queued connection when the window is hidden.', '', null), kind: 'handoff', origin: 'panel', parentId: 'testing', target: claude, status: 'delivered' },
  { ...record('review-reply', claude, 50000, 'Please review whether we can lose a queued connection when the window is hidden.', 'The backend owns the queue, so hiding the window does not interrupt delivery. Add a test for process replacement.', [4000, 2000, 14000]), origin: 'panel', parentId: 'handoff:a' },
  record('final-review', second, 95000, 'Review the final changes and explain any remaining risks.', 'Review is still in progress.', null),
];
window.activityCalls = [];
window.activityFail = false;
window.activityOlder = false;
mockIPC(async (command, args) => {
  window.activityCalls.push({ command, args });
  if (command === 'activity_list') {
    if (window.activityFail) throw new Error('Activity storage is unavailable');
    const all = window.activityRecords.filter(r => !args.since || r.startedAt >= args.since).sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
    const data = args.before ? all.filter(r => r.startedAt < args.before.at) : all;
    return { records: data, hasMore: window.activityOlder && !args.before, health: { error: null, lastScan: Date.now() } };
  }
  if (command === 'plugin:dialog|save') return 'C:\\test\\activity.json';
  return null;
});
if (new URLSearchParams(location.search).has('empty')) window.activityRecords = [];
document.documentElement.setAttribute('data-theme', 'dark');
document.body.style.margin = '0';
createRoot(document.getElementById('root')).render(<div style={{ height: '100vh' }}><ActivityView /></div>);
