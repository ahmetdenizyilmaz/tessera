import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1340, height: 900 } });
const errors = [];
// The fixture has no native Tauri WebSocket endpoint (same as panel-ui tests).
page.on('pageerror', error => { if (error.message !== 'WebSocket closed without opened.') errors.push(error.message); });
await page.route('**/hibernation-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/hibernation-fixture.jsx"></script>` }));
const calls = command => page.evaluate(c => window.calls.filter(call => call.command === c), command);
try {
  await page.clock.install();
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1425'}/hibernation-test`);
  const current = page.locator('.mosaic-tile').filter({ has: page.locator('.instance-name', { hasText: /^Current panel$/ }) });
  const old = page.locator('.mosaic-tile').filter({ has: page.locator('.instance-name', { hasText: /^Old terminal$/ }) });
  await expect(old.locator('.xterm')).toBeVisible();
  await expect(current.getByLabel('Message Codex')).toBeEnabled();
  await expect(page.getByLabel('Hibernate unused agent panels')).toHaveValue('60');
  const oldId = await old.getAttribute('data-panel-id');
  await page.clock.fastForward(1000);
  await old.getByTitle('Panel controls').click();
  await old.getByRole('button', { name: 'Hibernate panel', exact: true }).click();
  await expect(old.getByRole('button', { name: 'Wake panel', exact: true })).toBeVisible();
  await expect(old.locator('.xterm')).toHaveCount(0);
  await expect(old.getByLabel('Last panel content')).toContainText('All tests passed');
  expect((await calls('panel_hibernate')).length).toBe(1);
  const startsBefore = (await calls('codex_configure')).length;
  await page.evaluate(id => window.ensureCodex(id), oldId);
  await old.getByTitle('Double-click to rename').click();
  expect((await calls('codex_configure')).length).toBe(startsBefore);
  console.log('PASS sleeping terminal preserves its visible text, releases xterm, and stays asleep on focus/background configure');

  await page.evaluate(() => window.saveWorkspace());
  await page.reload();
  await expect(old.getByRole('button', { name: 'Wake panel', exact: true })).toBeVisible();
  await expect(old.getByLabel('Last panel content')).toContainText('All tests passed');
  await expect(current.getByLabel('Message Codex')).toBeEnabled();
  expect((await calls('codex_configure')).length).toBe(1);
  await current.getByTitle('Double-click to rename').click();
  await mkdir('.tmp/hibernation', { recursive: true });
  await page.screenshot({ path: '.tmp/hibernation/sleeping-panel.png' });
  await old.getByRole('button', { name: 'Wake panel', exact: true }).click();
  await expect(old.locator('.xterm')).toBeVisible();
  const resume = (await calls('codex_configure')).at(-1).args;
  expect(resume.threadId).toBe('thread-Old terminal');
  expect(resume.config.sandbox).toBe('danger-full-access');
  expect((await calls('codex_send')).length).toBe(0);
  console.log('PASS restart keeps sleeping state and preview; Wake reconnects the same terminal with the same policy and no model turn');

  // Real app timer; shorten setup by seeding accumulated RUNNING time.
  await page.clock.fastForward(16000); // consume fresh output/input observations
  await current.getByTitle('Double-click to rename').click();
  await page.clock.fastForward(16000);
  const id = await old.getAttribute('data-panel-id');
  await page.evaluate(id => {
    window.codex.setState(s => ({ sessions: { ...s.sessions, [id]: { ...s.sessions[id], busy: true } } }));
    window.markOld(id);
  }, id);
  await page.clock.fastForward(16000);
  await expect(old.locator('.xterm')).toBeVisible();
  await page.evaluate(id => {
    window.codex.setState(s => ({ sessions: { ...s.sessions, [id]: { ...s.sessions[id], busy: false } } }));
    window.markOld(id);
  }, id);
  await page.clock.fastForward(16000);
  await expect(old.getByRole('button', { name: 'Wake panel', exact: true })).toBeVisible();
  await expect(current.getByLabel('Message Codex')).toBeEnabled();
  console.log('PASS automatic timeout sleeps the old idle panel while protecting the focused panel and quiet busy work');
  expect(errors).toEqual([]);
} finally { await browser.close(); }
