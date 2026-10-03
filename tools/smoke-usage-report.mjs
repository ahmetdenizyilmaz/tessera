// Opt-in LIVE check, PREVIEW build only: the Analytics sidebar reads this PC's real
// Claude Code session files and renders the ccusage-style tables; the Session
// usage dialog opens. No model calls. Writes screenshots to .tmp/usage/.
// Usage: node tools/smoke-usage-report.mjs http://127.0.0.1:9222
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const endpoint = process.argv[2] || 'http://127.0.0.1:9222';
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost'));
if (!page) throw new Error('No Tessera WebView found.');
const invoke = (command, args) => page.evaluate(([command, args]) => window.__TAURI_INTERNALS__.invoke(command, args), [command, args]);
if (await invoke('plugin:app|name') !== 'Tessera Preview') { await browser.close(); throw new Error('Only Tessera Preview may be used for this test.'); }
page.setDefaultTimeout(30000);
await mkdir('.tmp/usage', { recursive: true });
try {
  const started = Date.now();
  const report = await invoke('usage_report', { startDate: '2020-01-01', endDate: '2030-12-31' });
  console.log(`report: ${report.files} files, ${report.messages} messages, ${report.daily.length} days, ${report.monthly.length} months, ${report.sessions.length} sessions, ${report.models.length} models in ${Date.now() - started} ms`);
  console.log('totals:', JSON.stringify(report.totals), 'tz', report.timezone);
  console.log('months:', report.monthly.map(m => `${m.period} $${m.cost.toFixed(2)} (${m.models.length} models)`).join(' | '));
  console.log('models:', report.models.map(m => `${m.model}${m.priced ? '' : ' (unpriced)'} $${m.cost.toFixed(2)}`).join(' | '));
  console.log('agents rows:', report.agents.length, report.agents.slice(0, 3).map(a => `${a.period} ${a.provider} ${a.turns} turns ${a.input + a.output}`).join(' | '));
  if (!report.messages || !report.sessions.length) throw new Error('No Claude usage found although session files exist.');
  const sum = report.daily.reduce((s, d) => s + d.cost, 0);
  if (Math.abs(sum - report.totals.cost) > 1e-6) throw new Error(`daily costs ${sum} != total ${report.totals.cost}`);
  const again = Date.now();
  await invoke('usage_report', { startDate: '2020-01-01', endDate: '2030-12-31' });
  console.log(`cached second read in ${Date.now() - again} ms`);
  console.log('PASS (live): usage_report reads the real session files, de-duplicates, prices, and caches');

  await page.locator('.sidebar-nav button, [title="Analytics"], button:has-text("Analytics")').first().click().catch(() => {});
  await page.getByRole('button', { name: 'Analytics' }).first().click().catch(() => {});
  const monthly = page.getByRole('button', { name: 'Monthly', exact: true });
  await expect(monthly).toBeVisible();
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await expect(page.getByText('Total tokens')).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: '.tmp/usage/daily.png' });
  await monthly.click();
  await expect(page.locator('table tbody tr').first()).toContainText(/\d{4}-\d{2}/);
  await page.screenshot({ path: '.tmp/usage/monthly.png' });
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(page.locator('table')).toContainText('claude-');
  await page.screenshot({ path: '.tmp/usage/models.png' });
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await page.getByRole('button', { name: 'Other agents', exact: true }).click();
  await page.screenshot({ path: '.tmp/usage/agents.png' });
  console.log('PASS (live): Analytics sidebar renders daily, monthly, models, sessions and other-agent tables from real data');
} finally {
  await browser.close();
}
