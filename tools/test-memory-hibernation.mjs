import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1340, height: 900 } });
const errors = [];
page.on('pageerror', error => { if (error.message !== 'WebSocket closed without opened.') errors.push(error.message); });
await page.route('**/hibernation-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/hibernation-fixture.jsx"></script>` }));
try {
  await page.clock.install();
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1425'}/hibernation-test`);
  const current = page.locator('.mosaic-tile').filter({ has: page.locator('.instance-name', { hasText: /^Current panel$/ }) });
  const old = page.locator('.mosaic-tile').filter({ has: page.locator('.instance-name', { hasText: /^Old terminal$/ }) });
  await expect(old.locator('.xterm')).toBeVisible();
  await expect(current.getByLabel('Message Codex')).toBeEnabled();
  await page.clock.fastForward(1000);
  const oldId = await old.getAttribute('data-panel-id');
  await page.evaluate(() => window.settings.getState().updateSettings({ panelHibernationMinutes: 0 }));
  const ram = page.getByRole('button', { name: 'Memory usage and panel hibernation' });
  const menu = page.getByRole('dialog', { name: 'Memory', exact: true });
  const action = menu.getByRole('button', { name: /^Hibernate unused panels/ });

  await ram.click();
  await expect(menu).toBeVisible();
  await expect(action).toBeDisabled();
  await expect(menu).toContainText('No panels idle for 30+ minutes.');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(ram).toBeFocused();
  console.log('PASS RAM menu opens above the footer, disables empty cleanup, and closes with Escape');

  await page.evaluate(id => window.markOld(id, 30), oldId);
  await ram.click();
  await expect(action).toBeEnabled();
  await expect(menu).toContainText('1 panel idle for 30+ minutes.');
  await page.evaluate(id => window.codex.setState(s => ({ sessions: { ...s.sessions, [id]: { ...s.sessions[id], busy: true } } })), oldId);
  await page.clock.fastForward(1100);
  await expect(action).toBeDisabled();
  await page.evaluate(id => window.codex.setState(s => ({ sessions: { ...s.sessions, [id]: { ...s.sessions[id], busy: false } } })), oldId);
  await page.clock.fastForward(1100);
  await expect(action).toBeEnabled();
  await mkdir('.tmp/hibernation', { recursive: true });
  await page.screenshot({ path: '.tmp/hibernation/memory-menu.png' });
  await page.evaluate(() => { window.failSleep = true; });
  await action.click();
  await expect(menu.getByRole('alert')).toContainText('1 could not hibernate');
  await expect(old.locator('.xterm')).toBeVisible();
  await page.evaluate(() => { window.failSleep = false; });
  await action.click();
  await expect(menu.getByRole('status')).toContainText('Hibernated 1 panel.');
  await expect(old.getByRole('button', { name: 'Wake panel', exact: true })).toBeVisible();
  await expect(old.getByLabel('Last panel content')).toContainText('All tests passed');
  await expect(current.getByLabel('Message Codex')).toBeEnabled();
  await expect(action).toBeDisabled();
  expect(await page.evaluate(() => window.settings.getState().settings.panelHibernationMinutes)).toBe(0);
  expect(await page.evaluate(() => window.calls.filter(c => c.command === 'panel_hibernate').length)).toBe(2);
  console.log('PASS 30-minute manual cleanup works with auto sleep disabled, protects busy work, reports failures and retries successfully');

  await current.getByTitle('Double-click to rename').click();
  await expect(menu).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 600 });
  await ram.click();
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox(), anchor = await ram.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(352);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThan(anchor.y);
  expect(await menu.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await menu.getByRole('button', { name: 'Close memory menu' }).click();
  await expect(menu).toHaveCount(0);
  console.log('PASS menu avoids footer clipping, stays inside a narrow window, and closes on outside click');
  expect(errors).toEqual([]);
} finally { await browser.close(); }
