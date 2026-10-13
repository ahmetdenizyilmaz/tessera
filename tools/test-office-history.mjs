// Synthetic emoji-rich histories, with an optional local transcript for diagnosis.
// No provider calls; the real Office UI runs against the isolated IPC fixture.
import { chromium, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const base = process.argv[2] ?? 'http://127.0.0.1:1420';
const artifactDir = '../tessera-office-validation';
mkdirSync(artifactDir, { recursive: true });
try {
  await page.goto(`${base}/tools/office-fixture.html`);
  await expect(page.locator('[data-office-agent="architect"]')).toBeVisible();
  const rows = process.env.OFFICE_HISTORY_FILE
    ? JSON.parse(readFileSync(process.env.OFFICE_HISTORY_FILE, 'utf8'))
    : Array.from({ length: 2000 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Message ${i}: \u{1f4a1} Thinking \u{1f469}\u200d\u{1f4bb} \u{1f680}\u{1f680}\n\nLook at "src/item-${i}.ts" and ~/Desktop/project.\n\n| Check | Result |\n| --- | --- |\n| Unicode | \u{1f44d} |\n\n${'Progress continues with ordinary prose. '.repeat(8)}` }));
  await page.evaluate(rows => {
    window.officeHistory.large = rows;
    const base = window.instances.getState().instances.get('architect');
    window.instances.setState(s => ({ instances: new Map([...s.instances, ['large', { ...base, id: 'large', name: 'Large conversation', claudeSessionId: 'large', config: { ...base.config, panelView: 'terminal' } }]]) }));
  }, rows);
  const openedAt = Date.now();
  await page.locator('[data-office-agent="large"]').click();
  await expect(page.locator('.office-chat .msg')).toHaveCount(40);
  console.log(`PASS ${rows.length}-message transcript opens (${Date.now() - openedAt} ms), with 40 recent messages rendered`);
  await expect.poll(() => page.locator('.office-chat-messages').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(65);
  const lookups = await page.evaluate(() => window.officeCalls.filter(c => c.command === 'resolve_path_smart').length);
  const reads = await page.evaluate(() => window.officeCalls.filter(c => c.command === 'session_load_history').length);
  await expect.poll(() => page.evaluate(() => window.officeCalls.filter(c => c.command === 'session_load_history').length), { timeout: 8000 }).toBeGreaterThan(reads + 1);
  expect(await page.evaluate(() => window.officeCalls.filter(c => c.command === 'resolve_path_smart').length)).toBe(lookups);
  console.log('PASS repeated history polling does not remount unchanged Markdown or repeat file lookups');

  await page.locator('.office-chat-messages').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Show earlier messages' }).click();
  await expect(page.locator('.office-chat .msg')).toHaveCount(80);
  const anchor = await page.locator('.office-chat .msg').nth(40).boundingBox();
  await page.evaluate(() => window.officeHistory.large.push({ role: 'assistant', content: 'New answer \u{1f389} after opening older messages.' }));
  await expect(page.locator('.office-chat .msg')).toHaveCount(81);
  const after = await page.locator('.office-chat .msg').nth(40).boundingBox();
  expect(Math.abs(anchor.y - after.y)).toBeLessThan(3);
  await page.getByRole('button', { name: 'Latest messages' }).click();
  await expect(page.locator('.office-chat .msg')).toHaveCount(40);
  await expect(page.locator('.office-chat-messages')).toContainText('New answer');
  await expect.poll(() => page.locator('.office-chat-messages').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(65);
  await page.getByRole('button', { name: 'Close agent chat' }).click();
  await expect(page.locator('.office-chat')).toHaveCount(0);
  console.log('PASS older messages remain accessible, live updates retain scroll position, latest resets the tail, and chat closes');

  await page.evaluate(() => {
    const session = window.codex.getState().sessions.tester;
    window.codex.setState(s => ({ sessions: { ...s.sessions, tester: { ...session, items: Array.from({ length: 1500 }, (_, i) => ({ id: `unicode-${i}`, type: 'agentMessage', text: `Codex answer ${i}: \u{1f680} src/main.ts` })) } } }));
  });
  await page.locator('[data-office-agent="tester"]').click();
  await expect(page.locator('.office-chat-messages')).toContainText('Codex answer 1499');
  await expect(page.locator('.office-chat .codex-message')).toHaveCount(40);
  await page.keyboard.press('Escape');
  await expect(page.locator('.office-chat')).toHaveCount(0);
  await page.locator('[data-office-agent="architect"]').click();
  await expect(page.locator('.office-chat-messages')).toContainText('Refactor the connection manager');
  await page.getByRole('button', { name: 'Open full chat' }).click();
  await expect(page.getByRole('button', { name: 'Return to office' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to office' }).click();
  await page.evaluate(() => window.previewThoughtBubbles());
  await page.locator('[data-bubble-preview]').screenshot({ path: `${artifactDir}/thought-bubbles.png` });
  expect(errors).toEqual([]);
  console.log('PASS large Codex history, agent switching, Escape, leaving Office and white thought-bubble preview');
} finally { await browser.close(); }
