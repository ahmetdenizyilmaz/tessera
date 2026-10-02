// Opt-in LIVE check, PREVIEW build only: a multi-line paste into the real agy
// terminal arrives as one block and is not submitted. No model call is made.
// Usage: node tools/smoke-antigravity-paste.mjs http://127.0.0.1:9222 C:\a\folder\agy\already\trusts
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const [endpoint, project] = process.argv.slice(2);
if (!endpoint || !project) throw new Error('Provide the preview CDP endpoint and a project folder agy already trusts.');
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'));
if (!page) throw new Error('No Tessera WebView found.');
if (await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|name')) !== 'Tessera Preview') { await browser.close(); throw new Error('Only Tessera Preview may be used for this test.'); }
page.setDefaultTimeout(30000);
const name = `Agy Paste ${randomUUID().slice(0, 8)}`;
const panel = page.locator('.antigravity-panel').filter({ has: page.getByText(name, { exact: true }) });
const lines = ['PASTE_CHECK_ONE', 'PASTE_CHECK_TWO', 'PASTE_CHECK_THREE'];
try {
  await page.getByTitle('New session', { exact: true }).click();
  await page.locator('.panel-view-option').filter({ hasText: 'Terminal' }).click();
  await page.locator('.nsw-tile').filter({ hasText: 'Antigravity' }).click();
  await expect(page.getByRole('status', { name: 'Antigravity CLI status' })).toContainText('CLI found', { timeout: 60000 });
  await page.getByPlaceholder('Choose the project this agent can work in').fill(project);
  await page.locator('.antigravity-panel').evaluateAll(elements => elements.forEach(e => e.setAttribute('data-smoke-existing', 'true')));
  await page.getByRole('button', { name: 'Open Antigravity terminal', exact: true }).click();
  const fresh = page.locator('.antigravity-panel:not([data-smoke-existing])');
  await fresh.waitFor({ timeout: 120000 });
  await fresh.getByTitle('Double-click to rename').dblclick();
  await fresh.getByLabel('Panel name').fill(name);
  await fresh.getByLabel('Panel name').press('Enter');
  const screen = panel.locator('.codex-terminal');
  await expect(panel.locator('.xterm')).toBeVisible({ timeout: 120000 });
  // The input box is ready once agy shows its model line. A trust prompt means the folder is wrong for this test.
  await expect(screen).toContainText(/Gemini|Claude|GPT/i, { timeout: 60000 });
  if (/Do you trust/i.test(await screen.innerText())) throw new Error('agy asks to trust this folder; pass a folder it already trusts.');
  await page.waitForTimeout(1500);
  const before = await screen.innerText();
  await panel.locator('.xterm-helper-textarea').evaluate((node, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, lines.join('\r\n'));
  await page.waitForTimeout(4000);
  const after = await screen.innerText();
  console.log('--- terminal after paste ---\n' + after.split('\n').filter(l => l.trim()).slice(-14).join('\n') + '\n---');
  for (const line of lines) if (!after.includes(line)) throw new Error(`Pasted line missing from the input: ${line}`);
  // A submitted first line would start a turn: the input box would no longer hold all three lines together.
  const tail = after.slice(after.lastIndexOf(lines[0]));
  if (!tail.includes(lines[1]) || !tail.includes(lines[2])) throw new Error('The paste was split: lines are not together in the input box.');
  if (/PASTE_CHECK_ONE/.test(before)) throw new Error('Stale screen content.');
  console.log('PASS (live): a three-line paste arrived in the agy input as one block and was not submitted');
} finally {
  if (await panel.count()) await panel.getByTitle('Close instance', { exact: true }).evaluate(button => button.click());
  await browser.close();
}
