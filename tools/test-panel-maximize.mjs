// Real keyboard input, mocked agents. Run Vite first.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.route('**/panel-ui-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/panel-ui-fixture.jsx"></script>` }));
const max = () => page.evaluate(() => window.layout.getState().maximizedId);
try {
  await page.goto('http://127.0.0.1:1420/panel-ui-test');
  await page.waitForFunction(() => window.showMosaic);
  await page.evaluate(() => window.showMosaic(3));
  const input = page.locator('[data-panel-id="codex-ui"] .xterm-helper-textarea');
  await input.focus();
  const before = await page.evaluate(() => [...window.layout.getState().panelRects]);
  await page.evaluate(() => { window.calls = []; });
  await page.keyboard.down('F11');
  await expect.poll(max).toBe('codex-ui');
  await page.keyboard.down('F11'); // OS key repeat must not toggle back.
  expect(await max()).toBe('codex-ui');
  await page.keyboard.up('F11');
  await expect(input).toBeFocused();
  await page.keyboard.press('F11');
  await expect.poll(max).toBeNull();
  expect(await page.evaluate(() => [...window.layout.getState().panelRects])).toEqual(before);
  expect(await page.evaluate(() => window.calls.filter(c => c.command === 'pty_write'))).toEqual([]);
  console.log('PASS F11 maximizes/restores a focused terminal, preserves its layout and input focus, ignores repeat, and sends no PTY bytes');

  await page.evaluate(() => {
    const dialog = document.createElement('div'); dialog.className = 'dialog-overlay'; document.body.append(dialog);
  });
  await page.keyboard.press('F11');
  expect(await max()).toBeNull();
  await page.evaluate(() => document.querySelector('.dialog-overlay').remove());
  await page.keyboard.press('Shift+F11');
  expect(await max()).toBeNull();
  await page.evaluate(() => document.querySelector('.mosaic-container').parentElement.inert = true);
  await page.keyboard.press('F11');
  expect(await max()).toBeNull();
  await page.evaluate(() => document.querySelector('.mosaic-container').parentElement.inert = false);
  console.log('PASS modal/hidden workspaces and modified shortcuts do not resize panels');

  const plus = page.getByRole('button', { name: 'New session', exact: true });
  const close = page.locator('[data-panel-id="codex-ui"] .toolbar-btn.close');
  for (const button of [plus, close]) {
    const { dx, dy } = await button.evaluate(el => {
      const b = el.getBoundingClientRect(), s = el.querySelector('svg').getBoundingClientRect();
      return { dx: b.x + b.width / 2 - s.x - s.width / 2, dy: b.y + b.height / 2 - s.y - s.height / 2 };
    });
    expect(Math.abs(dx)).toBeLessThan(0.1); expect(Math.abs(dy)).toBeLessThan(0.1);
  }
  await expect(close.locator('svg')).toHaveAttribute('width', '18');
  await plus.click();
  await expect.poll(() => page.evaluate(() => window.layout.getState().widgetKinds[window.layout.getState().activeTabId])).toBe('new-session');
  console.log('PASS centered New Session button opens its wizard; panel close icon is centered and larger');

  await page.goto('http://127.0.0.1:1420/tools/window-fixture.html');
  await page.waitForFunction(() => !!window.windows);
  const popup = page.waitForEvent('popup');
  await page.evaluate(() => window.windows.detachPanel(window.lichess));
  const child = await popup;
  await page.evaluate(() => window.windows.movePanelToWindow(window.timer, window.workspaces.getState().windows[0]));
  await expect(child.locator('.mosaic-tile')).toHaveCount(2);
  await child.locator('.detached-tab').filter({ hasText: 'Timer' }).click();
  const timer = await page.evaluate(() => window.timer);
  const visible = () => child.locator('.mosaic-tile').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).visibility !== 'hidden').map(node => node.dataset.panelId));
  const frame = child.frameLocator('iframe');
  await frame.locator('body').click({ position: { x: 10, y: 10 } });
  await child.keyboard.press('F11');
  await expect.poll(visible).toEqual([timer]);
  expect(await max()).toBeNull();
  await child.keyboard.press('F11');
  await expect.poll(async () => (await visible()).length).toBe(2);
  // The native website shortcut enters through this same window-local event.
  const lichess = await page.evaluate(() => window.lichess);
  await child.evaluate(id => window.dispatchEvent(new CustomEvent('tessera:maximize-panel', { detail: id })), lichess);
  await expect.poll(visible).toEqual([lichess]);
  expect(await max()).toBeNull();
  console.log('PASS plugin iframe F11 and browser-panel events resize only their detached workspace');
} finally { await browser.close(); }
