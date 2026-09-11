// npm run dev, then node tools/test-panel-switch.mjs [http://127.0.0.1:1420]
// Real mosaic layout and xterm; mocked PTYs, no user sessions or model turns.
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', error => {
  if (!error.message.includes('WebSocket closed without opened')) console.error(error.message);
});
await page.route('**/panel-ui-test', route => route.fulfill({
  contentType: 'text/html',
  body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/panel-ui-fixture.jsx"></script>`,
}));
const state = () => page.evaluate(() => {
  const t = window.terminals.get('codex-ui'), b = t.buffer.active;
  return { cols: t.cols, rows: t.rows, top: b.viewportY, base: b.baseY,
    text: b.getLine(b.viewportY)?.translateToString(true) };
});
const switchTo = async id => {
  await page.locator(`[data-panel-id="${id}"]`).getByTitle('Double-click to rename').click();
  await page.waitForTimeout(350); // The real mosaic's pointer lock lasts 270 ms.
};
const resizeCalls = () => page.evaluate(() => window.calls.filter(c =>
  c.command === 'pty_resize' && c.args.id === 'codex-ui'));
try {
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/panel-ui-test`);
  await page.waitForFunction(() => !!window.showMosaic);
  // Real startup first renders an empty workspace; autosave restores panels
  // afterward. Container measurement must already be observing that root.
  await page.evaluate(() => window.showEmptyMosaic());
  await page.locator('.mosaic-empty').waitFor();
  await page.waitForTimeout(100);
  await page.evaluate(() => window.showMosaic(5));
  await page.waitForFunction(() => window.terminals.has('codex-ui'));
  expect(await page.locator('[data-panel-id="codex-ui"]').evaluate(e =>
    e.firstElementChild.style.width.endsWith('px')), 'Restored panels must use final pixel geometry during the tile animation').toBe(true);
  await expect.poll(async () => (await state()).cols).toBeGreaterThan(80);
  await page.evaluate(() => new Promise(resolve => window.terminals.get('codex-ui').write(
    Array.from({ length: 250 }, (_, i) => `History ${i}: ${'long output '.repeat(16)}`).join('\r\n'), resolve)));
  await page.waitForTimeout(100);
  const initial = await state();
  expect(initial.top).toBe(initial.base);
  await page.evaluate(() => { window.calls = []; });
  for (let i = 0; i < 3; i++) {
    await switchTo('peer-ui');
    expect(await state()).toEqual(initial);
    await switchTo('codex-ui');
    expect(await state()).toEqual(initial);
  }
  expect(await resizeCalls()).toEqual([]);
  console.log('PASS five-panel switches preserve terminal geometry and input, with no native resize/replay trigger');

  await page.locator('[data-panel-id="codex-ui"] .xterm').hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await state()).top).toBeLessThan(initial.base);
  const reading = await state();
  await switchTo('peer-ui');
  await switchTo('codex-ui');
  expect(await state()).toEqual(reading);
  expect(await resizeCalls()).toEqual([]);
  const input = page.locator('[data-panel-id="codex-ui"] .xterm-helper-textarea');
  await input.focus();
  await input.pressSequentially('draft');
  await expect.poll(async () => { const s = await state(); return s.top === s.base; }).toBe(true);
  expect(await page.evaluate(() => window.calls.filter(c => c.command === 'pty_write').map(c => c.args.data).join(''))).toBe('draft');
  console.log('PASS intentional history reading survives a panel switch; typing still reveals the input');

  // A real window resize still fits the active terminal. Its inactive peer
  // keeps its working geometry until explicitly activated.
  const peerSize = await page.evaluate(() => {
    const t = window.terminals.get('peer-ui'); return { cols: t.cols, rows: t.rows };
  });
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect.poll(async () => (await state()).cols).toBeGreaterThan(initial.cols);
  await expect.poll(async () => (await resizeCalls()).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => {
    const t = window.terminals.get('peer-ui'); return { cols: t.cols, rows: t.rows };
  })).toEqual(peerSize);
  await switchTo('peer-ui');
  await expect.poll(() => page.evaluate(() => window.terminals.get('peer-ui').cols)).toBeGreaterThan(peerSize.cols);
  console.log('PASS real window resizing fits the active terminal and defers inactive geometry until activation');
} finally {
  await browser.close();
}
