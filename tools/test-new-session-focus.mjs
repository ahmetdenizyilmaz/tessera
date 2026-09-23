// npm run dev, then node tools/test-new-session-focus.mjs [http://127.0.0.1:1420]
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', error => {
  if (!error.message.includes('WebSocket closed without opened')) errors.push(error.message);
});
await page.route('**/new-session-focus-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/new-session-focus-fixture.jsx"></script>` }));

try {
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/new-session-focus-test`);
  const plus = page.getByTitle('New session', { exact: true });
  await plus.click();
  const id = await page.evaluate(() => window.layout.getState().focusedId);
  const tile = page.locator(`[data-panel-id="${id}"]`);
  await expect(tile).toBeVisible();
  await page.evaluate(() => window.wizard.getState().set({ panelView: 'terminal', cwd: 'C:/keep-this-project' }));
  const focusOther = () => page.locator('.tab-item').filter({ hasText: 'Other panel 1' }).click();
  const expectWizardFocused = async () => {
    await expect.poll(() => page.evaluate(() => window.layout.getState().focusedId)).toBe(id);
    await expect(tile).toBeVisible();
    await expect.poll(async () => (await tile.boundingBox()).width).toBeGreaterThan(700);
    expect(await page.evaluate(() => ({
      count: window.layout.getState().tabOrder.length,
      view: window.wizard.getState().panelView,
      cwd: window.wizard.getState().cwd,
    }))).toEqual({ count: 5, view: 'terminal', cwd: 'C:/keep-this-project' });
  };

  await focusOther();
  await expect.poll(async () => (await tile.boundingBox()).width).toBeLessThan(400);
  await plus.click();
  await expectWizardFocused();
  await focusOther();
  await page.getByText('File', { exact: true }).click();
  await page.getByText('New Instance...', { exact: true }).click();
  await expectWizardFocused();
  await focusOther();
  await page.getByTitle('New instance (Ctrl+N)', { exact: true }).click();
  await expectWizardFocused();
  console.log('PASS tab +, File > New Instance, and status-bar + refocus the same wizard without resetting selections');

  await focusOther();
  await page.evaluate(() => window.layout.getState().toggleMaximized(window.layout.getState().focusedId));
  await expect(tile).toBeHidden();
  await plus.click();
  await expectWizardFocused();
  expect(await page.evaluate(() => window.layout.getState().maximizedId)).toBe(id);
  console.log('PASS reopening the wizard reveals it when another panel is maximized');
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
