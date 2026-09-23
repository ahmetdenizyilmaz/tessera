// Opt-in real OpenCode contract test. Uses a loopback fake model, never API keys.
// node tools/test-opencode-cli.mjs /path/to/opencode[.exe]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const executable = process.argv[2] || 'opencode';
const root = await mkdtemp(join(tmpdir(), 'tessera-opencode-contract-'));
await mkdir(join(root, 'project'));
let mode = 'text', calls = 0, receivedTools = [];
const model = createServer(async (req, res) => {
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'fixture' }] })); }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end(); }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); calls++;
  receivedTools = body.tools?.map(t => t.function.name) ?? [];
  const last = body.messages.at(-1);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  if (mode === 'slow') { res.write(': waiting\n\n'); return; }
  let delta, finish;
  if (last?.role !== 'tool' && mode === 'permission') {
    assert(receivedTools.includes('bash'));
    delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'call_bash', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'echo TESSERA_OPENCODE_TOOL_OK', description: 'Print a test marker' }) } }] };
    finish = 'tool_calls';
  } else if (last?.role !== 'tool' && mode === 'question') {
    assert(receivedTools.includes('question'));
    delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'call_question', type: 'function', function: { name: 'question', arguments: JSON.stringify({ questions: [{ header: 'Fixture', question: 'Which test choice?', options: [{ label: 'First', description: 'First fixture choice' }, { label: 'Second', description: 'Second fixture choice' }] }] }) } }] };
    finish = 'tool_calls';
  } else { delta = { role: 'assistant', content: 'TESSERA_OPENCODE_FIXTURE_ANSWER' }; finish = 'stop'; }
  const chunk = (d, reason) => `data: ${JSON.stringify({ id: 'fixture-response', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fixture', choices: [{ index: 0, delta: d, finish_reason: reason }] })}\n\n`;
  res.end(chunk(delta, null) + chunk({}, finish) + 'data: [DONE]\n\n');
});
await new Promise(r => model.listen(0, '127.0.0.1', r));
const modelPort = model.address().port;
const portProbe = createServer();
await new Promise(r => portProbe.listen(0, '127.0.0.1', r));
const port = portProbe.address().port;
await new Promise(r => portProbe.close(r));
const password = randomUUID();
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA'].includes(k.toUpperCase())));
Object.assign(env, {
  XDG_DATA_HOME: join(root, 'data'), XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'),
  OPENCODE_SERVER_PASSWORD: password, OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_PURE: 'true',
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ autoupdate: false, share: 'disabled', model: 'tessera-local/fixture', small_model: 'tessera-local/fixture', enabled_providers: ['tessera-local'], default_agent: 'build', permission: { '*': 'ask', read: 'allow', glob: 'allow', grep: 'allow', question: 'allow' }, provider: { 'tessera-local': { npm: '@ai-sdk/openai-compatible', name: 'Fixture', options: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'fixture-only' }, models: { fixture: { name: 'Fixture', tool_call: true, limit: { context: 32768, output: 4096 } } } } } }),
});
let child, log = '';
const launch = () => {
  child = spawn(executable.includes('/') || executable.includes('\\') ? resolve(executable) : executable, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { env, cwd: join(root, 'project'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
};
const stop = async () => { if (child && child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } };
const api = async (path, body) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(15000), method: body ? 'POST' : 'GET', headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  assert(response.ok, `${path} HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
};
const until = async (get, check, label) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const value = await get();
    if (check(value)) return value;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timed out: ${label}. Log: ${log.slice(-3000)}`);
};
const ready = () => until(() => api('/global/health').catch(() => null), v => v?.healthy, 'startup');
try {
  launch(); await ready();
  assert.equal((await fetch(`http://127.0.0.1:${port}/session`)).status, 401);
  const session = await api('/session', { title: 'Tessera fixture', agent: 'build', model: { providerID: 'tessera-local', id: 'fixture' } });
  const sid = session.id;
  const prompt = (text, extra = {}) => ({ model: { providerID: 'tessera-local', modelID: 'fixture' }, agent: 'build', parts: [{ type: 'text', text }], ...extra });
  await api(`/session/${sid}/message`, prompt('Inherited context, no summary needed', { noReply: true }));
  assert.equal(calls, 0, 'Seeding must not invoke a model');
  await api(`/session/${sid}/prompt_async`, prompt('Test plain reply'));
  const messages = await until(() => api(`/session/${sid}/message`), a => a.some(m => m.info.role === 'assistant' && m.info.time.completed), 'first response');
  assert(messages.some(m => m.parts.some(p => p.text?.includes('TESSERA_OPENCODE_FIXTURE_ANSWER'))));
  const idle = () => until(() => api('/session/status'), statuses => !statuses[sid] || statuses[sid].type === 'idle', 'idle');
  await idle();
  console.log('PASS authenticated loopback server, session create, no-cost fork context, chat response');
  mode = 'permission';
  await api(`/session/${sid}/prompt_async`, prompt('Test approval'));
  const permissions = await until(() => api('/permission'), a => a.length, 'permission request');
  assert.equal(permissions[0].sessionID, sid);
  assert.equal(permissions[0].permission, 'bash');
  await api(`/permission/${permissions[0].id}/reply`, { reply: 'reject' });
  await idle();
  console.log('PASS command approval surfaced and rejected without running command');
  mode = 'question';
  await api(`/session/${sid}/prompt_async`, prompt('Test question'));
  const questions = await until(() => api('/question'), a => a.length, 'question request');
  await api(`/question/${questions[0].id}/reply`, { answers: [['Second']] });
  await idle();
  console.log('PASS structured question and selected answer');
  mode = 'slow';
  await api(`/session/${sid}/prompt_async`, prompt('Test cancel'));
  await until(() => api('/session/status'), a => a[sid]?.type === 'busy', 'busy before interrupt');
  await api(`/session/${sid}/abort`, {}); await idle();
  console.log('PASS interrupted model request');
  const savedCount = (await api(`/session/${sid}/message`)).length;
  await stop(); launch(); await ready();
  assert.equal((await api(`/session/${sid}`)).id, sid);
  assert.equal((await api(`/session/${sid}/message`)).length, savedCount);
  console.log('PASS exact session and history resume after process restart');
} finally { await stop(); model.closeAllConnections(); await new Promise(r => model.close(r)); }
