// LIVE contract test: drives the real, signed-in Antigravity CLI and makes a few
// small model calls. It pins the behavior Tessera's integration relies on, so a
// CLI update that changes it fails here instead of inside a panel.
//   node tools/test-antigravity-cli.mjs [path/to/agy] [model-slug]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const AGY = process.argv[2] || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe') : join(process.env.HOME, '.local', 'bin', 'agy'));
const MODEL = process.argv[3] || 'gemini-3.8-flash-low';
const root = mkdtempSync(join(tmpdir(), 'tessera-agy-contract-'));
const stream = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', MODEL];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function session(name, extra = [], args = stream) {
  const cwd = join(root, name);
  mkdirSync(cwd, { recursive: true });
  const child = spawn(AGY, [...args, ...extra], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const events = [], waiters = [];
  let buffer = '', stderr = '';
  child.stdout.on('data', data => {
    buffer += data.toString('utf8');
    for (let i; (i = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      events.push(event);
      waiters.splice(0).forEach(check => check());
    }
  });
  child.stderr.on('data', data => { stderr += data.toString('utf8'); });
  const exited = new Promise(resolve => child.on('exit', code => { waiters.splice(0).forEach(check => check()); resolve(code); }));
  const until = (predicate, label, ms = 120000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: timed out waiting for ${label}\n${stderr}`)), ms);
    const check = () => {
      const found = predicate();
      if (found) { clearTimeout(timer); resolve(found); } else if (child.exitCode !== null) { clearTimeout(timer); reject(new Error(`${name}: exited before ${label}\n${stderr}`)); } else waiters.push(check);
    };
    check();
  });
  return {
    child, events, exited, until, stderr: () => stderr,
    init: () => until(() => events.find(e => e.event === 'init'), 'init'),
    async turn(text) {
      const seen = events.filter(e => e.event === 'result').length;
      const from = events.length;
      child.stdin.write(JSON.stringify({ event: 'user', message: { content: text } }) + '\n');
      const result = await until(() => events.filter(e => e.event === 'result')[seen], 'result');
      return { result: result.result, steps: events.slice(from).filter(e => e.event === 'step_update').map(e => e.step_update) };
    },
    async end() { child.stdin.end(); return exited; },
  };
}
const sum = steps => steps.filter(s => s.usage).reduce((total, s, _, all) => all.findLast(x => x.step_index === s.step_index) === s ? total + s.usage.total_tokens : total, 0);
const pass = message => console.log(`PASS (live) ${message}`);

try {
  const version = spawnSync(AGY, ['--version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(version.status, 0, `agy --version failed: ${version.stderr}`);
  const models = spawnSync(AGY, ['models'], { encoding: 'utf8', windowsHide: true }).stdout.split('\n').filter(line => line.includes('\t')).map(line => line.split('\t')[0].trim());
  assert.ok(models.includes(MODEL), `agy models does not list ${MODEL}: ${models.join(', ')}`);
  pass(`agy ${version.stdout.trim()} found; "agy models" lists ${models.length} slug<TAB>name rows`);

  // init arrives without any input, with the conversation ID a panel pins.
  const a = session('a');
  const init = await a.init();
  assert.match(init.conversation_id, UUID);
  assert.equal(init.init.permission_mode, 'request-review');
  assert.ok(Array.isArray(init.init.tools) && init.init.tools.length > 0);
  assert.equal(a.events.length, 1, 'nothing but init before the first message');

  // Turn 1: a shell command under default permissions is refused, and the refusal is reported.
  const first = await a.turn('The code word is marzipan. Run this exact shell command with your command tool: echo tessera-contract. Then reply with one short sentence.');
  assert.equal(first.result.status, 'SUCCESS');
  assert.equal(first.result.conversation_id, init.conversation_id);
  const command = first.steps.filter(s => s.step_type === 'tool' && s.tool_name === 'run_command');
  assert.ok(command.length, 'the command tool was not attempted');
  assert.ok(command.every(s => s.tool_info?.parameters), 'tool steps carry their parameters');
  assert.ok(first.steps.every(s => ['ACTIVE', 'DONE', 'ERROR'].includes(s.state)), 'unknown step state');
  const denied = first.result.denied_actions?.length || /auto-denied/.test(a.stderr()) || command.some(s => /denied/i.test(s.tool_info?.error?.message ?? ''));
  assert.ok(denied, 'a command that needs approval must be reported as denied in headless mode');
  assert.equal(first.result.usage.total_tokens, first.result.usage.input_tokens + first.result.usage.output_tokens, 'thinking tokens are part of output');
  assert.equal(sum(first.steps), first.result.usage.total_tokens, 'per-step usage adds up to the first result');
  pass('init before input, tool steps with parameters, auto-denied command reported, usage totals consistent');

  // Turn 2 in the same process: streamed text, and the counter is cumulative.
  const second = await a.turn('What is the code word? Reply with just the word.');
  assert.match(second.result.response.toLowerCase(), /marzipan/);
  const deltas = second.steps.filter(s => s.step_type === 'agent_response').map(s => s.text_delta ?? '').join('');
  assert.equal(deltas, second.result.response, 'text deltas reassemble the response');
  assert.equal(second.result.num_turns, 2);
  assert.equal(second.result.usage.total_tokens, first.result.usage.total_tokens + sum(second.steps), 'result.usage is cumulative for the conversation');
  assert.equal(await a.end(), 0, 'closing stdin ends the session cleanly');
  pass('second turn in one process, deltas reassemble the response, cumulative usage, clean exit on EOF');

  // Resume by ID in a new process: same conversation, nothing replayed, counter continues.
  const lastStep = Math.max(...a.events.filter(e => e.event === 'step_update').map(e => e.step_update.step_index));
  const resumed = session('a', ['--conversation', init.conversation_id]);
  assert.equal((await resumed.init()).conversation_id, init.conversation_id);
  const third = await resumed.turn('Once more: the code word, just the word.');
  assert.match(third.result.response.toLowerCase(), /marzipan/);
  assert.ok(third.steps.every(s => s.step_index > lastStep), 'earlier steps are not replayed on resume');
  assert.equal(third.result.usage.total_tokens, second.result.usage.total_tokens + sum(third.steps), 'the counter continues across processes');

  // Stop: killing the process mid-turn leaves a conversation that still resumes.
  resumed.child.stdin.write(JSON.stringify({ event: 'user', message: { content: 'Write a 600-word essay about lighthouses.' } }) + '\n');
  await resumed.until(() => resumed.events.some(e => e.event === 'step_update' && e.step_update.text_delta && e.step_update.step_index > third.steps.at(-1).step_index), 'streamed essay text');
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(resumed.child.pid), '/T', '/F'], { windowsHide: true }); else resumed.child.kill('SIGKILL');
  assert.notEqual(await resumed.exited, 0);
  const after = session('a', ['--conversation', init.conversation_id]);
  assert.equal((await after.init()).conversation_id, init.conversation_id);
  const fourth = await after.turn('After that interruption: the code word, just the word.');
  assert.match(fourth.result.response.toLowerCase(), /marzipan/);
  await after.end();
  pass('resume by exact ID without replay, counter continues across processes, a killed turn leaves a resumable conversation');

  // Two sessions at once are separate conversations. No model calls from here on.
  const [b, c] = [session('b'), session('c')];
  const [initB, initC] = await Promise.all([b.init(), c.init()]);
  assert.notEqual(initB.conversation_id, initC.conversation_id);
  assert.notEqual(initB.init.cwd, initC.init.cwd);
  await Promise.all([b.end(), c.end()]);

  // An unknown conversation is NOT an error for agy: it warns and opens a different one.
  const unknown = session('b', ['--conversation', '00000000-0000-4000-8000-000000000000']);
  const other = await unknown.init();
  assert.notEqual(other.conversation_id, '00000000-0000-4000-8000-000000000000', 'Tessera must compare the ID itself');
  assert.match(unknown.stderr(), /not found/);
  await unknown.end();

  // Permission flags are visible in init; a bad model fails before init with a result.
  const skip = session('b', ['--dangerously-skip-permissions']);
  assert.equal((await skip.init()).init.permission_mode, 'always-proceed');
  await skip.end();
  const edits = session('b', ['--mode', 'accept-edits', '--sandbox', '--effort', 'low']);
  assert.match((await edits.init()).conversation_id, UUID);
  assert.equal(await edits.end(), 0);
  const bad = session('b', [], ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', 'definitely-not-a-model']);
  assert.equal(await bad.exited, 1);
  assert.equal(bad.events.length, 1);
  assert.equal(bad.events[0].result.status, 'ERROR');
  assert.match(bad.events[0].result.error, /invalid model selection/);
  pass('simultaneous sessions are separate, unknown conversation is silently replaced (so Tessera checks the ID), permission flags, bad model error');
  console.log('All Antigravity CLI contract checks passed against the real CLI.');
} finally {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* a just-ended process may still hold the folder */ }
}
