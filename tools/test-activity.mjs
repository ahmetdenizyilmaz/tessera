// npm run dev, then node tools/test-activity.mjs [http://127.0.0.1:1420]
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
page.setDefaultNavigationTimeout(90000);
page.setDefaultTimeout(15000);
page.on('pageerror', error => { if (!error.message.includes('WebSocket closed without opened')) errors.push(error.message); });
await page.route('**/activity-test*', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/activity-fixture.jsx"></script>` }));
try {
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/activity-test`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-activity-node]')).toHaveCount(5);
  await expect(page.locator('.activity-stats')).toContainText('190.0k');
  await expect(page.locator('.activity-stats')).toContainText('1 turn has unavailable usage');
  await expect(page.locator('.activity-lane-label')).toContainText(['You', 'Backend architect', 'Test engineer', 'Code review']);
  await page.locator('[data-activity-node="review-reply"]').click();
  await expect(page.getByRole('complementary', { name: 'Activity details' })).toContainText('From Test engineer · Codex');
  await expect(page.locator('.activity-details')).toContainText('14,000');
  await page.screenshot({ path: '../tessera-activity-validation/flow.png', fullPage: true });
  await page.getByRole('button', { name: 'Close activity details' }).click();
  const before = await page.locator('.activity-graph-tools > span').innerText();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await page.locator('.activity-graph-tools > span').innerText()).not.toBe(before);
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
  console.log('PASS graph displays named provider lanes, causal links, selectable messages, and correct token totals');

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.activity-event')).toHaveCount(5);
  await page.getByRole('combobox', { name: 'Filter provider' }).selectOption('codex');
  await expect(page.locator('.activity-event')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Filter provider' }).selectOption('all');
  await page.getByRole('textbox', { name: 'Search activity' }).fill('process replacement');
  await expect(page.locator('.activity-event')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search activity' }).fill('');
  await page.locator('.activity-event').filter({ hasText: 'Code review' }).click();
  await expect(page.locator('.activity-details')).toContainText('Token usage has not been reported');
  await page.screenshot({ path: '../tessera-activity-validation/timeline.png', fullPage: true });
  await page.getByRole('button', { name: 'Close activity details' }).click();
  await page.evaluate(() => {
    const turn = window.activityRecords.find(r => r.id === 'final-review');
    turn.usage = { input: 1000, output: 2000, cacheRead: 7000, cacheWrite: 0, reasoning: 0 };
    turn.response = 'The review is complete.';
  });
  await expect(page.locator('.activity-stats')).toContainText('200.0k', { timeout: 8000 });
  await expect(page.locator('.activity-event')).toHaveCount(5);
  await page.getByRole('button', { name: 'Export visible activity' }).click();
  await expect.poll(() => page.evaluate(() => window.activityCalls.some(call => call.command.includes('write_text_file')))).toBe(true);
  console.log('PASS filters, complete message details, unavailable usage, and live updates without duplication');

  await page.setViewportSize({ width: 390, height: 820 });
  await expect(page.getByRole('button', { name: 'Expand activity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand activity', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Activity history' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Activity history' })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  console.log('PASS narrow layout and expanded view keyboard dismissal');

  await page.evaluate(() => { window.activityOlder = true; });
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load older', exact: true })).toBeVisible();
  await page.evaluate(() => { const old = { ...window.activityRecords[0], id: 'older-question', startedAt: Date.now() - 86400000, prompt: 'Earlier question' }; window.activityRecords.push(old); });
  await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await expect(page.locator('.activity-event')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Load older', exact: true })).toHaveCount(0);
  console.log('PASS older pages merge without duplicating existing records');

  // Antigravity turns: chat name, provider, model, tools, reported usage, an honest unavailable turn, and an incoming handoff link.
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.evaluate(() => {
    const agy = { id: 'agy-build', name: 'Release build', provider: 'antigravity', model: 'gemini-3.8-flash-low', device: null };
    const base = window.activityRecords[0], at = Date.now();
    window.activityRecords.push(
      { ...base, id: 'handoff:agy', target: agy, kind: 'handoff', origin: 'panel', status: 'delivered', prompt: 'Please run the release build.', response: '', usage: null, startedAt: at - 3000, updatedAt: at - 3000 },
      { ...base, id: 'antigravity:conv:t1', actor: agy, sessionId: 'conv', origin: 'panel', parentId: 'handoff:agy', prompt: 'Please run the release build.', response: 'The release build passes.', tools: ['Bash', 'Write'],
        usage: { input: 12529, output: 699, cacheRead: 0, cacheWrite: 0, reasoning: 330 }, startedAt: at - 2000, updatedAt: at - 1000 },
      { ...base, id: 'antigravity:conv:t2', actor: agy, sessionId: 'conv', prompt: 'A question that was stopped', response: '', status: 'interrupted', tools: [], usage: null,
        usageNote: 'Antigravity did not report token usage for this turn.', startedAt: at - 500, updatedAt: at - 400 });
  });
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filter provider' }).selectOption('antigravity');
  await expect(page.locator('.activity-event')).toHaveCount(3);
  await expect(page.locator('.activity-stats')).toContainText('13.2k');
  await expect(page.locator('.activity-stats')).toContainText('1 turn has unavailable usage');
  await page.locator('.activity-event').filter({ hasText: 'Please run the release build.' }).filter({ hasText: 'Release build' }).first().click();
  const details = page.locator('.activity-details');
  await expect(details).toContainText('Release build');
  await expect(details.locator('.activity-provider--antigravity')).toHaveText('Antigravity');
  await expect(details).toContainText('gemini-3.8-flash-low');
  await expect(details).toContainText('Bash, Write');
  await expect(details).toContainText('12,529');
  await expect(details).toContainText('330 reasoning tokens included in output.');
  await expect(details).toContainText('From Backend architect · Claude');
  await expect(details).toContainText('Incoming message');
  await expect(details).toContainText('The release build passes.');
  await page.screenshot({ path: '.tmp/antigravity-integration/ui/activity.png', fullPage: true });
  await page.getByRole('button', { name: 'Close activity details' }).click();
  await page.locator('.activity-event').filter({ hasText: 'A question that was stopped' }).click();
  await expect(details).toContainText('interrupted');
  await expect(details).toContainText('Token usage has not been reported for this turn.');
  await expect(details).toContainText('Antigravity did not report token usage for this turn.');
  await page.getByRole('button', { name: 'Close activity details' }).click();
  await page.getByRole('combobox', { name: 'Filter provider' }).selectOption('all');
  console.log('PASS Antigravity records show chat name, provider, model, tools, reported and unavailable usage, and the incoming handoff link');

  await page.evaluate(() => { window.activityFail = true; });
  await expect(page.getByRole('alert')).toContainText('storage is unavailable', { timeout: 8000 });
  await page.evaluate(() => { window.activityFail = false; });
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 8000 });
  await page.reload();
  await expect(page.locator('[data-activity-node]')).toHaveCount(5);
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/activity-test?empty`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Your conversations will take shape here')).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS error recovery, reload, and empty state');
} finally { await browser.close(); }
