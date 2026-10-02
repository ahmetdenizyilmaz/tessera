// Opt-in LIVE check of Antigravity panels in an already running PREVIEW WebView2:
// the real app, the real Tauri commands and the real, signed-in agy CLI.
// Usage: node tools/smoke-antigravity.mjs http://127.0.0.1:9222 C:\path\to\scratch-project [model-slug]
// Launch preview with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.
// Creates and closes its own panels and consumes four small model turns.
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const [endpoint, project, model = 'gemini-3.8-flash-low'] = process.argv.slice(2);
if (!endpoint || !project) throw new Error('Provide the preview CDP endpoint and a scratch project folder.');
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'));
if (!page) throw new Error('No Tessera WebView found.');
const invoke = (command, args) => page.evaluate(([command, args]) => window.__TAURI_INTERNALS__.invoke(command, args), [command, args]);
if (await invoke('plugin:app|name') !== 'Tessera Preview') { await browser.close(); throw new Error('Only Tessera Preview may be used for this test.'); }
page.setDefaultTimeout(30000);
const suffix = randomUUID().slice(0, 8);
const names = [`Agy Chat ${suffix}`, `Agy Second ${suffix}`, `Agy Terminal ${suffix}`];
const panel = name => page.locator('.antigravity-panel').filter({ has: page.getByText(name, { exact: true }) });
const saved = name => page.evaluate(name => JSON.parse(localStorage.getItem('tessera-autosave')).instances.find(i => i.name === name), name);

async function create(view, name) {
  await page.getByTitle('New session', { exact: true }).click();
  await page.locator('.panel-view-option').filter({ hasText: view }).click();
  await page.locator('.nsw-tile').filter({ hasText: 'Antigravity' }).click();
  const status = page.getByRole('status', { name: 'Antigravity CLI status' });
  await expect(status).toContainText('CLI found', { timeout: 60000 });
  await expect(status).toContainText('Signed in');
  await page.getByPlaceholder('Choose the project this agent can work in').fill(project);
  await page.getByLabel('Antigravity model').selectOption(model);
  await page.locator('.antigravity-panel').evaluateAll(elements => elements.forEach(e => e.setAttribute('data-smoke-existing', 'true')));
  await page.getByRole('button', { name: `Open Antigravity ${view.toLowerCase()}`, exact: true }).click();
  const fresh = page.locator('.antigravity-panel:not([data-smoke-existing])');
  await fresh.waitFor({ timeout: 120000 });
  await fresh.getByTitle('Double-click to rename').dblclick();
  await fresh.getByLabel('Panel name').fill(name);
  await fresh.getByLabel('Panel name').press('Enter');
  return panel(name);
}
// An unfocused panel is covered by a click-to-focus overlay, exactly as for a person.
const focus = target => target.locator('.agent-panel-toolbar').click({ force: true, position: { x: 150, y: 10 } });
async function ask(target, message, expected) {
  await focus(target);
  await target.getByLabel('Message Antigravity').fill(message);
  await target.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(target.locator('.agent-panel-status')).toHaveText('WORKING');
  await expect(target.locator('.agent-panel-status')).toHaveText('READY', { timeout: 120000 });
  await expect(target.locator('.codex-message:not(.codex-message-user)').last()).toContainText(expected);
}

try {
  const chat = await create('Chat', names[0]);
  await expect(chat.locator('.agent-panel-status')).toHaveText('READY');
  // Autosave is debounced: wait for the renamed panel and its pinned conversation to be written.
  await expect.poll(async () => (await saved(names[0]))?.antigravityConversationId ?? '', { timeout: 15000 }).toMatch(/^[0-9a-f-]{36}$/);
  const first = await saved(names[0]);
  await ask(chat, 'The code word is KESTREL. Reply exactly TESSERA_AGY_ONE. Do not use tools.', 'TESSERA_AGY_ONE');
  await expect(chat.locator('.antigravity-turn').last()).toContainText('Turn complete');
  await expect(chat.locator('.antigravity-turn').last()).toContainText('tokens');
  await ask(chat, 'What is the code word? Reply with just the word.', /KESTREL/i);
  await expect(chat.locator('.antigravity-turn')).toHaveCount(2);
  await expect(chat.locator('.antigravity-usage')).toContainText('Conversation:');
  console.log('PASS (live): chat panel starts on a pinned conversation, streams two turns, and shows reported usage');

  // A second panel works at the same time and never sees the first conversation.
  const second = await create('Chat', names[1]);
  await focus(chat);
  await chat.getByLabel('Message Antigravity').fill('Write four sentences about lighthouses.');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await ask(second, 'If you were told a code word in this conversation, say it. Otherwise reply exactly NO_CODE_WORD.', 'NO_CODE_WORD');
  await expect(chat.locator('.agent-panel-status')).toHaveText('READY', { timeout: 120000 });
  const [a, b] = [await saved(names[0]), await saved(names[1])];
  if (a.antigravityConversationId !== first.antigravityConversationId) throw new Error('The first panel changed conversation.');
  if (!b.antigravityConversationId || b.antigravityConversationId === a.antigravityConversationId || b.antigravityDataId === a.antigravityDataId) throw new Error('Panels share a conversation or storage.');
  console.log('PASS (live): two simultaneous panels with separate processes, conversations and storage');

  // Stop mid-turn, then continue the same conversation.
  await focus(chat);
  await chat.getByLabel('Message Antigravity').fill('Write a 700-word essay about tide pools.');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.locator('.codex-message:not(.codex-message-user)').last()).toContainText(/tide|pool/i, { timeout: 60000 });
  await chat.getByTitle('Stop current turn').click();
  await expect(chat.locator('.antigravity-turn').last()).toContainText('Turn stopped', { timeout: 30000 });
  await expect(chat.locator('.agent-panel-status')).toHaveText('READY');
  await expect(chat.locator('.antigravity-error-banner')).toHaveCount(0);
  await ask(chat, 'After that stop: what is the code word? Reply with just the word.', /KESTREL/i);
  if ((await saved(names[0])).antigravityConversationId !== first.antigravityConversationId) throw new Error('Stop changed the conversation.');
  console.log('PASS (live): stop ends the turn without an error, and the next message resumes the same conversation');

  // Native Activity records for the chat: named, attributed, counted once.
  await expect.poll(async () => {
    const page1 = await invoke('activity_list', { since: Date.now() - 3600000, limit: 500 });
    const turns = page1.records.filter(r => r.kind === 'turn' && r.actor.provider === 'antigravity' && r.sessionId === first.antigravityConversationId);
    return { count: turns.length, completed: turns.filter(r => r.status === 'completed' && r.usage && r.usage.input > 0).length,
      stopped: turns.filter(r => r.status === 'interrupted').length, named: turns.every(r => r.actor.name === names[0] && r.actor.model === model) };
  }, { timeout: 20000 }).toEqual({ count: 5, completed: 4, stopped: 1, named: true });
  console.log('PASS (live): Activity recorded five turns for the chat (four completed with usage, one stopped) under its name, provider and model');

  // Native terminal on a pinned conversation.
  const terminal = await create('Terminal', names[2]);
  await expect(terminal.locator('.xterm')).toBeVisible({ timeout: 120000 });
  await expect(terminal.getByLabel('Message Antigravity')).toHaveCount(0);
  await expect(terminal.locator('.codex-terminal')).toContainText(/trust|Antigravity|Gemini/i, { timeout: 60000 });
  await expect.poll(async () => (await saved(names[2]))?.antigravityConversationId ?? '', { timeout: 20000 }).toMatch(/^[0-9a-f-]{36}$/);
  await expect(terminal.locator('.antigravity-error-banner')).toHaveCount(0);
  console.log('PASS (live): the native agy terminal runs in a panel on its own pinned conversation');
} finally {
  for (const name of names) {
    const owned = panel(name);
    if (await owned.count()) await owned.getByTitle('Close instance', { exact: true }).evaluate(button => button.click());
  }
  await browser.close();
}
