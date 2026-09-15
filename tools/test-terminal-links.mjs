// Real terminal clicks with mocked OS opening; does not open browser tabs.
// Run npm run dev first, then node tools/test-terminal-links.mjs.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', error => {
  if (!error.message.includes('WebSocket closed without opened')) console.error(error);
});
await page.route('**/panel-ui-test', route => route.fulfill({
  contentType: 'text/html',
  body: `<div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script><script type="module" src="/tools/panel-ui-fixture.jsx"></script>`,
}));
try {
  await page.goto('http://127.0.0.1:1420/panel-ui-test');
  await page.waitForFunction(() => window.showEmptyMosaic, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    window.popups = 0; window.confirmations = 0;
    window.open = () => { window.popups++; return null; };
    window.confirm = () => { window.confirmations++; return false; };
    window.showEmptyMosaic();
  });
  await page.locator('.mosaic-empty').waitFor();
  await page.evaluate(() => window.showMosaic(2));
  await page.waitForFunction(() => window.terminals.has('codex-ui'));
  await page.waitForTimeout(350); // Mosaic's initial tile animation.
  const write = data => page.evaluate(data => new Promise(resolve =>
    window.terminals.get('codex-ui').write(data, resolve)), data);
  const opens = () => page.evaluate(() => window.calls.filter(c => c.command === 'plugin:shell|open'));
  const clickText = async text => {
    const link = page.locator('[data-panel-id="codex-ui"] .xterm-rows').getByText(text, { exact: true });
    await expect(link).toBeVisible();
    // xterm's screen handles mouse events; its text spans are pointer-events:none.
    const box = await link.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.mouse.click(x, y);
  };
  const plain = 'https://example.com/plain?q=one&other=two#section';
  const explicit = 'https://example.com/explicit?q=one&other=two#section';
  await page.locator('[data-panel-id="codex-ui"] .xterm-helper-textarea').focus();
  await write(`\x1b[2J\x1b[H${plain}\r\n\x1b]8;;${explicit}\x1b\\Documentation\x1b]8;;\x1b\\\r\n\x1b]8;;file:///C:/test.txt\x1b\\Local file\x1b]8;;\x1b\\`);
  await clickText(plain);
  await expect.poll(async () => (await opens()).map(c => c.args.path)).toEqual([plain]);
  await clickText('Documentation');
  await expect.poll(async () => (await opens()).map(c => c.args.path)).toEqual([plain, explicit]);
  await clickText('Local file');
  expect((await opens()).map(c => c.args.path)).toEqual([plain, explicit]);
  expect(await page.evaluate(() => [window.popups, window.confirmations])).toEqual([0, 0]);
  console.log('PASS plain and OSC 8 terminal links open once through native shell, preserve URL parameters, and bypass popups; non-HTTP links stay disabled');
} finally { await browser.close(); }
