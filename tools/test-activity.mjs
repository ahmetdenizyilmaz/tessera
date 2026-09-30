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
