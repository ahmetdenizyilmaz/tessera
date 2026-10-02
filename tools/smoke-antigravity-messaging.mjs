// Opt-in LIVE check, PREVIEW build only: an Antigravity chat agent uses Tessera's
// panel tools (through the stdio bridge in this executable) to message another
// panel, and Activity links the handoff. Real agy, a few small model turns.
// It registers the Preview's bridge in agy's global MCP list and removes it again.
// Usage: node tools/smoke-antigravity-messaging.mjs http://127.0.0.1:9222 C:\path\to\scratch-project [model-slug]
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
const names = [`Agy Sender ${suffix}`, `Agy Receiver ${suffix}`];
const panel = name => page.locator('.antigravity-panel').filter({ has: page.getByText(name, { exact: true }) });
const focus = target => target.locator('.agent-panel-toolbar').click({ force: true, position: { x: 150, y: 10 } });

async function create(name) {
  await page.getByTitle('New session', { exact: true }).click();
  await page.locator('.panel-view-option').filter({ hasText: 'Chat' }).click();
  await page.locator('.nsw-tile').filter({ hasText: 'Antigravity' }).click();
  await expect(page.getByRole('status', { name: 'Antigravity CLI status' })).toContainText('Signed in', { timeout: 60000 });
  await page.getByPlaceholder('Choose the project this agent can work in').fill(project);
  await page.getByLabel('Antigravity model').selectOption(model);
  await page.locator('.antigravity-panel').evaluateAll(elements => elements.forEach(e => e.setAttribute('data-smoke-existing', 'true')));
  await page.getByRole('button', { name: 'Open Antigravity chat', exact: true }).click();
  const fresh = page.locator('.antigravity-panel:not([data-smoke-existing])');
  await fresh.waitFor({ timeout: 120000 });
  await fresh.getByTitle('Double-click to rename').dblclick();
  await fresh.getByLabel('Panel name').fill(name);
  await fresh.getByLabel('Panel name').press('Enter');
  return panel(name);
}

const before = await invoke('antigravity_mcp_status');
if (before.panelTools.registered) throw new Error(`${before.panelTools.name} is already registered in agy; this test would remove it. Remove it yourself first if that is intended.`);
try {
  await invoke('antigravity_mcp_panel_tools', { executablePath: '', enable: true, allowInChat: true });
  const status = await invoke('antigravity_mcp_status');
  expect(status.panelTools).toMatchObject({ registered: true, current: true, allowedInChat: true });
  const server = status.panelTools.name;
  console.log(`PASS (live): ${server} registered with agy for this executable, with its three chat allow rules`);

  // The receiver first, so its renamed entry is in the roster before the sender looks.
  const receiver = await create(names[1]);
  const sender = await create(names[0]);
  await page.waitForTimeout(1500);
  await focus(sender);
  await sender.getByLabel('Message Antigravity').fill(`Use the MCP server "${server}". First call its list_panels tool. Then call its send_to_panel tool with panel "${names[1]}" and message "Reply with exactly: PANEL_PONG_${suffix}". Finally tell me in one sentence what send_to_panel returned.`);
  await sender.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sender.locator('.agent-panel-status')).toHaveText('WORKING');
  await expect(sender.locator('.agent-panel-status')).toHaveText('READY', { timeout: 180000 });
  const tools = await sender.locator('.antigravity-tool summary').allInnerTexts();
  console.log('sender tool steps:', tools.join(' | '));
  if (!tools.some(t => /call_mcp_tool · done/.test(t))) throw new Error('The sender did not complete an MCP tool call.');
  await expect(sender.locator('.antigravity-denied')).toHaveCount(0);

  // The message arrived in the other panel as its own turn, and that panel answered it.
  await expect(receiver.locator('.codex-message-user').last()).toContainText(`PANEL_PONG_${suffix}`, { timeout: 60000 });
  await expect(receiver.locator('.codex-message-user').last()).toContainText(`[panel-message from "${names[0]}"`);
  await expect(receiver.locator('.agent-panel-status')).toHaveText('READY', { timeout: 120000 });
  await expect(receiver.locator('.codex-message:not(.codex-message-user)').last()).toContainText(`PANEL_PONG_${suffix}`);
  console.log('PASS (live): the Antigravity agent listed panels and sent a message; the other panel received it as a turn and replied');

  // Activity: a handoff from the sender, linked to the turn that sent it and to the turn it caused.
  await expect.poll(async () => {
    const { records } = await invoke('activity_list', { since: Date.now() - 3600000, limit: 500 });
    const handoff = records.find(r => r.kind === 'handoff' && r.actor.name === names[0] && r.target?.name === names[1]);
    const caused = handoff && records.find(r => r.kind === 'turn' && r.parentId === handoff.id);
    const origin = handoff && records.find(r => r.id === handoff.parentId);
    return { handoff: handoff?.status ?? null, provider: handoff?.actor.provider ?? null, causedBy: caused?.actor.name ?? null, causedOrigin: caused?.origin ?? null, sentFrom: origin?.actor.name ?? null };
  }, { timeout: 20000 }).toEqual({ handoff: 'delivered', provider: 'antigravity', causedBy: names[1], causedOrigin: 'panel', sentFrom: names[0] });
  console.log('PASS (live): Activity recorded the handoff, linked to the sending turn and to the turn it started');
} finally {
  await invoke('antigravity_mcp_panel_tools', { executablePath: '', enable: false, allowInChat: false }).catch(e => console.log('cleanup failed:', String(e)));
  const after = await invoke('antigravity_mcp_status').catch(() => null);
  console.log('cleanup: registered =', after?.panelTools.registered, 'allowed =', after?.panelTools.allowedInChat);
  for (const name of names) {
    const owned = panel(name);
    if (await owned.count()) await owned.getByTitle('Close instance', { exact: true }).evaluate(button => button.click());
  }
  await browser.close();
}
