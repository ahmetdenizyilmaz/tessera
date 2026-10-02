// npm run dev -- --host 127.0.0.1, then node tools/test-antigravity-ui.mjs [base URL]
// MOCKED: real React wizard/panel/workspace code with a scripted backend. The
// real CLI is exercised by tools/test-antigravity-cli.mjs and test-rust.ps1 -Antigravity.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
expect.configure({ timeout: 15000 });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
const errors = [];
page.on('pageerror', e => { if (e.message !== 'WebSocket closed without opened.') errors.push(e.message); });
await page.route('**/antigravity-ui-test', r => r.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/tools/antigravity-ui-fixture.jsx"></script>` }));
const calls = name => page.evaluate(name => window.calls.filter(c => c.command === name).map(c => c.args), name);
const shots = '.tmp/antigravity-integration/ui';
const usage = { input: 12529, output: 699, thinking: 330, cacheRead: 0, total: 13228 };
const pick = async (view) => {
  await page.getByRole('button', { name: view === 'chat' ? /^Chat Rich GUI/ : /^Terminal Native coding/ }).click();
  await page.getByRole('button', { name: 'Antigravity · Google sign-in' }).click();
};
const refresh = id => page.evaluate(id => window.refresh(id, true), id);
try {
  await mkdir(shots, { recursive: true });
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/antigravity-ui-test`);
  await pick('chat');
  const cli = page.getByRole('status', { name: 'Antigravity CLI status' });
  await expect(cli).toContainText('CLI found · agy 1.2.15');
  await expect(cli).toContainText('Signed in');
  await expect(page.getByLabel('Antigravity model').locator('option')).toHaveText(["agy's saved default model", 'Gemini 3.8 Flash (High)', 'Gemini 3.8 Flash (Low)', 'Claude Sonnet 4.6 (Thinking)']);
  await expect(page.getByText('cannot show approval prompts', { exact: false })).toBeVisible();
  await page.screenshot({ path: `${shots}/setup.png`, fullPage: true });

  // Setup problems are stated with the next step, and never block silently.
  await page.evaluate(() => { window.auth = { state: 'signed-out', detail: 'No saved Antigravity sign-in was found in Windows Credential Manager.' }; });
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(cli).toContainText('Not signed in');
  await expect(cli).toContainText("agy's own browser flow");
  await expect(page.getByRole('button', { name: 'Open sign-in terminal' })).toBeVisible();
  await page.screenshot({ path: `${shots}/setup-signed-out.png`, fullPage: true });
  await page.evaluate(() => { window.discoverFail = 'Antigravity CLI (agy) was not found. Install it from https://antigravity.google/docs/cli/install/'; });
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(cli).toContainText('CLI not available');
  await expect(cli).toContainText('irm https://antigravity.google/cli/install.ps1 | iex');
  await expect(page.getByRole('button', { name: 'Open Antigravity chat', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${shots}/setup-missing-cli.png`, fullPage: true });
  await page.getByText('Antigravity CLI executable').click();
  await page.getByPlaceholder(/agy\.exe · found automatically/).fill('D:/tools/agy.exe');
  await page.evaluate(() => { window.discoverFail = null; window.auth = { state: 'signed-in', detail: 'A saved Antigravity sign-in was found.' }; });
  await expect(cli).toContainText('D:/tools/agy.exe');
  await page.getByLabel('Antigravity model').selectOption('gemini-3.8-flash-low');

  // A failed start stays in the wizard with agy's own reason, and is retryable.
  await page.evaluate(() => { window.startFail = 'You are not logged into Antigravity.'; });
  await page.getByRole('button', { name: 'Open Antigravity chat', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('You are not logged into Antigravity.');
  expect(await page.evaluate(() => window.instances.getState().instances.size)).toBe(0);
  await page.evaluate(() => { window.startFail = null; });
  await page.getByRole('button', { name: 'Open Antigravity chat', exact: true }).click();
  const a = page.locator('[data-panel="Antigravity · gemini-3.8-flash-low"]');
  await expect(a.getByLabel('Message Antigravity')).toBeEnabled();
  await expect(a.locator('.agent-panel-status')).toHaveText('READY');
  const idA = await page.evaluate(() => window.layout.getState().tabOrder.find(id => window.instances.getState().instances.has(id)));
  expect((await calls('antigravity_configure')).at(-1)).toMatchObject({ id: idA, start: true, conversationId: null, config: { model: 'gemini-3.8-flash-low', permission: 'review', executablePath: 'D:/tools/agy.exe', cwd: 'C:/fixture/project' } });
  await expect(a.getByText('Conversation token usage: not reported yet')).toBeVisible();
  console.log('PASS setup: CLI/sign-in status, missing CLI and sign-in guidance, custom executable, model discovery, failed start stays retryable');

  // Turn 1: tool activity, a denied action, streamed text, reported usage.
  await a.getByLabel('Message Antigravity').fill('Check this project');
  await a.getByLabel('Message Antigravity').press('Enter');
  await expect(a.getByText('Check this project')).toBeVisible();
  await expect(a.locator('.agent-panel-status')).toHaveText('WORKING');
  await expect(a.getByText('Quiet periods are normal', { exact: false })).toBeVisible();
  await expect(a.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  // Quiet output: several poll intervals with no events must not flip the panel to ready.
  await page.waitForTimeout(1500);
  await expect(a.locator('.agent-panel-status')).toHaveText('WORKING');
  await page.evaluate(id => window.agy.tool(id, 'run_command', 'active', { parameters: { CommandLine: 'npm test' } }), idA);
  await expect(a.getByText('run_command · running')).toBeVisible();
  await page.evaluate(id => { window.agy.tool(id, 'run_command', 'error', { error: 'permission check failed for command "npm test": user denied permission to run command' }); window.agy.say(id, 'The project has '); }, idA);
  await expect(a.getByText('run_command · failed')).toBeVisible();
  await a.getByLabel('Message Antigravity').fill('Keep this draft');
  await page.evaluate(id => window.agy.say(id, 'three packages.'), idA);
  await expect(a.getByText('The project has three packages.')).toBeVisible();
  await expect(a.getByLabel('Message Antigravity')).toHaveValue('Keep this draft');
  await expect(a.getByLabel('Message Antigravity')).toBeFocused();
  await page.evaluate(([id, usage]) => window.agy.finish(id, 'completed', usage, { denied: 'RunCommand' }), [idA, usage]);
  await expect(a.locator('.agent-panel-status')).toHaveText('READY');
  await expect(a.getByText('Denied by Antigravity: RunCommand')).toBeVisible();
  await expect(a.getByText('permissions.allow', { exact: false })).toBeVisible();
  await expect(a.locator('.antigravity-turn')).toHaveText('Turn complete · 3.5s · 13.2k tokens · 12.5k in · 699 out (330 thinking)');
  await expect(a.locator('.antigravity-usage')).toContainText('Conversation: 13.2k tokens');
  await page.screenshot({ path: `${shots}/chat-turn.png`, fullPage: true });

  // Turn 2 continues the same conversation; the conversation counter accumulates, the turn line does not.
  await a.getByLabel('Message Antigravity').fill('And the tests?');
  await a.getByRole('button', { name: 'Send', exact: true }).click();
  await page.evaluate(([id, usage]) => { window.agy.say(id, 'All tests pass.'); window.agy.finish(id, 'completed', { ...usage, input: 13708, output: 38, thinking: 35, total: 13746 }); }, [idA, usage]);
  await expect(a.getByText('All tests pass.')).toBeVisible();
  await expect(a.locator('.antigravity-turn').last()).toContainText('13.7k tokens');
  await expect(a.locator('.antigravity-usage')).toContainText('Conversation: 27.0k tokens');
  const sends = await calls('antigravity_send');
  expect(sends.map(s => s.text)).toEqual(['Check this project', 'And the tests?']);
  expect(await page.evaluate(id => window.instances.getState().instances.get(id).antigravityConversationId, idA)).toBe('conv-fixture-1');

  // A turn that reports no usage says so instead of showing zero.
  await a.getByLabel('Message Antigravity').fill('Quick question');
  await a.getByLabel('Message Antigravity').press('Enter');
  await page.evaluate(id => { window.agy.say(id, 'Answer.'); window.agy.finish(id, 'completed', null); }, idA);
  await expect(a.locator('.antigravity-turn').last()).toHaveText('Turn complete · 3.5s · token usage not reported');
  await expect(a.locator('.antigravity-usage')).toContainText('Conversation: 27.0k tokens');

  // Cancellation: a visible stop, no error state, and the panel is usable again.
  await a.getByLabel('Message Antigravity').fill('Write a long essay');
  await a.getByLabel('Message Antigravity').press('Enter');
  await page.evaluate(id => window.agy.say(id, 'For centuries'), idA);
  await a.getByTitle('Stop current turn').click();
  await expect(a.locator('.antigravity-turn').last()).toContainText('Turn stopped');
  await expect(a.getByText('This response was cut off', { exact: false })).toBeVisible();
  await expect(a.getByText('no in-band cancel', { exact: false })).toBeVisible();
  await expect(a.locator('.agent-panel-status')).toHaveText('READY');
  await expect(a.locator('.antigravity-error-banner')).toHaveCount(0);
  expect(await calls('antigravity_interrupt')).toEqual([{ id: idA }]);
  await expect(a.getByTitle('Stop current turn')).toHaveCount(0);

  // Expired sign-in: the error, what to do, and a one-click resend.
  await a.getByLabel('Message Antigravity').fill('After the token expired');
  await a.getByLabel('Message Antigravity').press('Enter');
  await page.evaluate(id => window.agy.finish(id, 'failed', null, { error: 'error getting token source: You are not logged into Antigravity.', recovery: 'login' }), idA);
  await expect(a.locator('.agent-panel-status')).toHaveText('SIGN IN');
  const alert = a.locator('.antigravity-error-banner');
  await expect(alert).toContainText('not logged into Antigravity');
  await expect(alert.getByRole('button', { name: 'Open sign-in terminal' })).toBeVisible();
  await page.screenshot({ path: `${shots}/chat-sign-in-error.png`, fullPage: true });
  await alert.getByRole('button', { name: 'Send the last message again' }).click();
  expect((await calls('antigravity_send')).at(-1)).toEqual({ id: idA, text: 'After the token expired' });
  await page.evaluate(([id, usage]) => { window.agy.say(id, 'Back online.'); window.agy.finish(id, 'completed', usage); }, [idA, usage]);
  await expect(a.locator('.agent-panel-status')).toHaveText('READY');
  await expect(a.locator('.antigravity-error-banner')).toHaveCount(0);

  // A crashed process is a failed turn with a reason and a recovery, not a silent stop.
  await a.getByLabel('Message Antigravity').fill('Trigger a crash');
  await a.getByLabel('Message Antigravity').press('Enter');
  await page.evaluate(id => window.agy.finish(id, 'failed', null, { error: 'Antigravity exited unexpectedly (exit code 1).', recovery: 'retry' }), idA);
  await expect(a.locator('.agent-panel-status')).toHaveText('ERROR');
  await expect(a.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await a.getByRole('button', { name: 'Reconnect' }).click();
  await expect(a.locator('.agent-panel-status')).toHaveText('READY');
  await expect(a.getByText('Back online.')).toBeVisible();
  expect((await calls('antigravity_configure')).at(-1)).toMatchObject({ id: idA, conversationId: 'conv-fixture-1', start: false });
  console.log('PASS chat: tool activity, denied action, streaming with draft focus, multi-turn, cumulative vs per-turn usage, unavailable usage, cancel, expired sign-in, crash and reconnect');

  // Permissions and model stay under the user's control, per panel.
  await a.getByTitle('Panel controls').click();
  await expect(a.getByLabel('Antigravity model')).toHaveValue('gemini-3.8-flash-low');
  await expect(a.getByText('Conversation: conv-fixture-1 · agy reports request-review · 60 tools')).toBeVisible();
  await a.getByLabel('Antigravity permissions').selectOption('accept-edits');
  await expect(a.locator('.agent-panel-metadata-text')).toContainText('Accept edits');
  expect((await calls('antigravity_configure')).at(-1)).toMatchObject({ id: idA, start: false, conversationId: 'conv-fixture-1', config: { permission: 'accept-edits', model: 'gemini-3.8-flash-low' } });
  await page.screenshot({ path: `${shots}/chat-controls.png`, fullPage: true });
  await page.keyboard.press('Escape');

  // A second simultaneous panel: its own process identity, conversation, settings and transcript.
  await page.getByRole('button', { name: 'New panel', exact: true }).click();
  await pick('chat');
  await page.getByLabel('Antigravity model').selectOption('claude-sonnet-4-6');
  await page.getByLabel('Permissions').selectOption('plan');
  await page.getByRole('button', { name: 'Open Antigravity chat', exact: true }).click();
  const b = page.locator('[data-panel="Antigravity · claude-sonnet-4-6"]');
  await expect(b.getByLabel('Message Antigravity')).toBeEnabled();
  const idB = await page.evaluate(idA => window.layout.getState().tabOrder.find(id => id !== idA && window.instances.getState().instances.has(id)), idA);
  await a.getByLabel('Message Antigravity').fill('Task for panel A');
  await a.getByLabel('Message Antigravity').press('Enter');
  await b.getByLabel('Message Antigravity').fill('Task for panel B');
  await b.getByLabel('Message Antigravity').press('Enter');
  await expect(a.locator('.agent-panel-status')).toHaveText('WORKING');
  await expect(b.locator('.agent-panel-status')).toHaveText('WORKING');
  await page.evaluate(([idB, usage]) => { window.agy.say(idB, 'Answer from B.'); window.agy.finish(idB, 'completed', usage); }, [idB, usage]);
  await expect(b.locator('.agent-panel-status')).toHaveText('READY');
  await expect(a.locator('.agent-panel-status')).toHaveText('WORKING');
  await expect(b.getByText('Answer from B.')).toBeVisible();
  await expect(a.getByText('Answer from B.')).toHaveCount(0);
  await expect(b.getByText('Task for panel A')).toHaveCount(0);
  await expect(b.locator('.antigravity-usage')).toContainText('Conversation: 13.2k tokens');
  await page.evaluate(id => { window.agy.say(id, 'Answer from A.'); window.agy.finish(id, 'completed', null); }, idA);
  const identities = await page.evaluate(([a, b]) => [a, b].map(id => { const i = window.instances.getState().instances.get(id); return [i.antigravityConversationId, i.antigravityDataId, i.config.model, i.config.antigravity.permission]; }), [idA, idB]);
  expect(identities[0][0]).toBe('conv-fixture-1'); expect(identities[1][0]).toBe('conv-fixture-2');
  expect(identities[0][1]).not.toBe(identities[1][1]);
  expect(identities.map(i => i.slice(2))).toEqual([['gemini-3.8-flash-low', 'accept-edits'], ['claude-sonnet-4-6', 'plan']]);
  await page.screenshot({ path: `${shots}/two-panels.png`, fullPage: true });
  console.log('PASS simultaneous panels: independent working state, transcripts, conversations, storage, model and permissions');

  // Workspace save/restore: same conversation IDs and transcripts, no process start, no model call.
  const before = (await calls('antigravity_send')).length;
  await page.evaluate(() => window.workspace.load(JSON.parse(JSON.stringify(window.workspace.save()))));
  const a2 = page.locator('[data-panel="Antigravity · gemini-3.8-flash-low"]');
  const b2 = page.locator('[data-panel="Antigravity · claude-sonnet-4-6"]');
  await expect(a2.getByText('Answer from A.')).toBeVisible();
  await expect(b2.getByText('Answer from B.')).toBeVisible();
  await expect(a2.getByText('Answer from B.')).toHaveCount(0);
  const restored = await page.evaluate(() => [...window.instances.getState().instances.values()].map(i => [i.id, i.antigravityConversationId, i.config.model, i.config.antigravity.permission]));
  expect(restored.map(r => r.slice(1)).sort()).toEqual([['conv-fixture-1', 'gemini-3.8-flash-low', 'accept-edits'], ['conv-fixture-2', 'claude-sonnet-4-6', 'plan']].sort());
  expect(restored.map(r => r[0])).not.toContain(idA);
  const resumes = (await calls('antigravity_configure')).slice(-2);
  expect(resumes.every(c => c.start === false && c.conversationId?.startsWith('conv-fixture-'))).toBe(true);
  expect((await calls('antigravity_send')).length).toBe(before);
  expect((await calls('antigravity_close')).map(c => c.id)).toEqual(expect.arrayContaining([idA, idB]));
  const idA2 = restored.find(r => r[1] === 'conv-fixture-1')[0];

  // The saved conversation is missing on this PC: reported, with an explicit way forward.
  await page.evaluate(id => { const s = window.snapshots[id]; s.error = 'The saved Antigravity conversation conv-fixture-1 was not found on this PC, so it was not resumed.'; s.recovery = 'new_conversation'; s.rev += 1; s.revision = `fixture:${s.rev}`; }, idA2);
  await refresh(idA2);
  await expect(a2.locator('.antigravity-error-banner')).toContainText('was not found on this PC');
  await expect(a2.getByRole('button', { name: 'Reconnect' })).toHaveCount(0);
  await a2.getByRole('button', { name: 'Start a new conversation here' }).click();
  await expect(a2.locator('.antigravity-error-banner')).toHaveCount(0);
  await expect(a2.getByText('New Antigravity conversation.', { exact: false })).toBeVisible();
  await expect(a2.getByText('Answer from A.')).toBeVisible();
  expect(await calls('antigravity_new_conversation')).toEqual([{ id: idA2 }]);
  expect(await page.evaluate(id => window.instances.getState().instances.get(id).antigravityConversationId, idA2)).toBeUndefined();
  await page.setViewportSize({ width: 620, height: 820 });
  await expect(a2.getByTitle('Close instance')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 920 });
  await a2.getByTitle('Close instance').click();
  await b2.getByTitle('Close instance').click();
  expect((await calls('antigravity_close')).length).toBeGreaterThanOrEqual(4);
  for (const foreign of ['stream_configure', 'stream_send_message', 'pty_spawn', 'codex_configure', 'codex_send', 'opencode_configure', 'opencode_send'])
    expect((await calls(foreign)).length, `${foreign} must never run for an Antigravity panel`).toBe(0);
  console.log('PASS workspace restore by exact conversation ID without model calls, missing-conversation recovery, narrow header, close, and no other provider commands');

  // Terminal: the native TUI through Antigravity's own spawn path.
  await page.getByRole('button', { name: 'New panel', exact: true }).click();
  await pick('terminal');
  await expect(page.getByText('The native terminal asks you before actions', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Open Antigravity terminal', exact: true }).click();
  await expect(page.locator('.xterm')).toBeVisible();
  await expect.poll(async () => (await calls('antigravity_terminal_spawn')).length).toBe(1);
  expect((await calls('antigravity_terminal_spawn'))[0]).toMatchObject({ initialPrompt: null });
  expect((await calls('antigravity_configure')).at(-1)).toMatchObject({ start: false });
  const terminal = page.locator('[data-panel^="Antigravity ·"]');
  await expect(terminal.getByLabel('Message Antigravity')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [...window.instances.getState().instances.values()][0].antigravityConversationId)).toMatch(/^conv-fixture-/);
  await terminal.getByTitle('Panel controls').click();
  await expect(terminal.getByText('Token usage is not available for terminal panels', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${shots}/terminal.png`, fullPage: true });
  expect((await calls('pty_spawn')).length + (await calls('codex_terminal_spawn')).length + (await calls('opencode_terminal_spawn')).length).toBe(0);

  await page.evaluate(() => window.showSettings(true));
  await expect(page.getByRole('heading', { name: 'Antigravity defaults' })).toBeVisible();
  await page.getByLabel('Permissions').selectOption('plan');
  await page.getByRole('button', { name: 'Save Antigravity defaults' }).click();
  await expect(page.getByText('Defaults saved. Existing panels are unchanged.')).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS terminal uses the Antigravity PTY with a pinned conversation (never Claude/Codex/OpenCode), honest terminal usage note, and defaults page');
} catch (error) {
  console.error('Browser errors:', errors);
  await page.screenshot({ path: `${shots}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
