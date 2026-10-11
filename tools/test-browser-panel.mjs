// Run with Vite on 1420. Real layout + browser lifecycle, mocked native views.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => { if (e.message !== 'WebSocket closed without opened.') errors.push(e.message); });
await page.route('**/browser-panel-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/browser-panel-fixture.jsx"></script>` }));
const visible = () => expect.poll(() => page.evaluate(() => !!window.views[window.lichess]?.bounds)).toBe(true);
const hidden = () => expect.poll(() => page.evaluate(() => window.views[window.lichess]?.bounds)).toBe(null);
try {
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/browser-panel-test`, { waitUntil: 'domcontentloaded' });
  await visible();
  await expect(page.getByRole('button', { name: 'Reload Lichess' })).toBeEnabled();
  await page.evaluate(() => window.layout.getState().setFocused(window.gameGroup));
  await hidden();
  await page.evaluate(() => {
    window.layout.getState().setRawPanelRects(new Map([
      [window.lichess, { x: 0, y: 0, w: 50, h: 100 }],
      [window.gameGroup, { x: 50, y: 0, w: 50, h: 100 }],
    ]));
  });
  await visible(); // Half-screen is playable even while the other panel has focus.
  await page.evaluate(() => window.layout.getState().setFocused(window.gameGroup));
  await hidden();
  await page.getByText('Click to focus and play').click({ force: true });
  await visible();
  await page.getByRole('button', { name: 'Maximize panel', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.views[window.lichess].bounds?.width)).toBeGreaterThan(1300);
  await page.setViewportSize({ width: 900, height: 650 });
  await expect.poll(() => page.evaluate(() => window.views[window.lichess].bounds?.width)).toBeLessThan(900);
  await page.getByRole('button', { name: 'Restore panel size' }).click();
  await visible();
  await page.locator(`[data-browser-surface]`).evaluate(el => el.closest('[data-panel-id]').querySelector('[title="Move to group"]').click());
  await expect(page.getByRole('dialog')).toBeVisible();
  await hidden();
  await page.keyboard.press('Escape');
  await visible();
  for (const className of ['menu-dropdown', 'context-menu']) {
    await page.evaluate(className => { const el = document.createElement('div'); el.id = 'blocker'; el.className = className; el.textContent = 'Menu'; document.body.append(el); }, className);
    await hidden();
    await page.evaluate(() => document.getElementById('blocker').remove());
    await visible();
  }
  await page.evaluate(() => document.getElementById('workspace').inert = true);
  await hidden();
  await page.evaluate(() => document.getElementById('workspace').inert = false);
  await visible();
  await page.evaluate(() => window.groups.getState().movePanelToLevel(window.lichess, window.gameGroup));
  await hidden();
  expect(await page.evaluate(() => window.calls.some(c => c.command === 'browser_panel_close'))).toBe(false);
  await page.evaluate(() => window.groups.getState().enterGroup(window.gameGroup));
  await visible();
  await page.getByRole('button', { name: 'Reload Lichess' }).click();
  expect(await page.evaluate(() => window.calls.some(c => c.command === 'browser_panel_action' && c.args.action === 'reload'))).toBe(true);
  await page.getByRole('button', { name: 'Close Lichess panel' }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(window.views).length)).toBe(0);
  expect(errors).toEqual([]);
  console.log('PASS browser resize, maximize, menus, dialogs, office hiding, group navigation, close, and StrictMode lifecycle');
} finally { await browser.close(); }
