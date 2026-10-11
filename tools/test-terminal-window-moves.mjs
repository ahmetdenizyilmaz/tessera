import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.context().on('page', p => p.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); }));
page.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); });
await page.route('**/terminal-window-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/panel-ui-fixture.jsx"></script>` }));
try {
  await page.goto('http://127.0.0.1:1420/terminal-window-test');
  await page.waitForFunction(() => !!window.showMosaic);
  await page.evaluate(() => {
    // Observe actual xterm parsing and fitting across component remounts.
    window.resizeBeforeParse = [];
    const write = window.Terminal.prototype.write, resize = window.Terminal.prototype.resize;
    window.Terminal.prototype.write = function(data, callback) {
      this.pendingTestWrites = (this.pendingTestWrites || 0) + 1;
      return write.call(this, data, () => { this.pendingTestWrites--; callback?.(); });
    };
    window.Terminal.prototype.resize = function(cols, rows) {
      if (this.pendingTestWrites > 0) window.resizeBeforeParse.push({ cols, rows });
      return resize.call(this, cols, rows);
    };
    window.showMosaic(3);
  });
  await expect(page.locator('.xterm')).toHaveCount(3);
  await page.evaluate(() => window.writeTerminalOutput(Array.from({ length: 400 }, (_, i) => `history-${i}\r\n`).join('') + '\x1b[32mMOVING PROMPT>\x1b[0m'));
  await expect(page.locator('[data-panel-id="codex-ui"] .xterm-rows')).toContainText('MOVING PROMPT>');
  const popup = page.waitForEvent('popup');
  await page.evaluate(() => window.workspaceWindows.detachPanel('codex-ui'));
  const child = await popup;
  await child.setViewportSize({ width: 980, height: 740 });
  await expect(child.locator('.xterm-rows')).toContainText('MOVING PROMPT>');
  await page.evaluate(() => window.workspaceWindows.movePanelToWindow('peer-ui', window.workspaces.getState().windows[0]));
  await expect(child.locator('.xterm')).toHaveCount(2);
  await child.locator('[data-tab-id="codex-ui"]').click();
  await page.waitForTimeout(400);
  // Layout changes during live output must repaint without a focus toggle.
  await page.evaluate(() => { window.calls = []; window.resizeBeforeParse = []; });
  const gutter = await child.locator('.mosaic-gutter-x').boundingBox();
  await child.mouse.move(gutter.x + 4, gutter.y + 40); await child.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await child.mouse.move(gutter.x - step * 15, gutter.y + 40);
    await page.evaluate(step => window.writeTerminalOutput(`\r\noutput-during-drag-${step}`), step);
  }
  await child.mouse.up();
  await page.evaluate(() => window.writeTerminalOutput('\r\nFINAL PROMPT>'));
  await expect(child.locator('[data-panel-id="codex-ui"] .xterm-rows')).toContainText('FINAL PROMPT>');
  await expect.poll(() => page.evaluate(() => window.calls.filter(c => c.command === 'pty_resize' && c.args.id === 'codex-ui').length)).toBeGreaterThan(0);
  const report = await page.evaluate(() => {
    const t = window.terminals.get('codex-ui');
    const resizes = window.calls.filter(c => c.command === 'pty_resize' && c.args.id === 'codex-ui');
    return { actual: { cols: t.cols, rows: t.rows }, requested: resizes.at(-1)?.args, resizes: resizes.length, early: window.resizeBeforeParse,
      sentInput: window.calls.filter(c => c.command === 'pty_write').length };
  });
  expect(report.requested).toMatchObject(report.actual);
  expect(report.resizes).toBeLessThanOrEqual(2);
  expect(report.early).toEqual([]); expect(report.sentInput).toBe(0);
  // Restore to Main while fresh output is arriving, retaining the last frame.
  await page.evaluate(async () => {
    await window.writeTerminalOutput('\r\nRETURNED PROMPT>');
    window.workspaceWindows.movePanelToWindow('codex-ui', null);
  });
  await expect(page.locator('[data-panel-id="codex-ui"] .xterm-rows')).toContainText('RETURNED PROMPT>');
  expect(await page.evaluate(() => window.resizeBeforeParse)).toEqual([]);
  expect(errors).toEqual([]);
  console.log('PASS live terminal detach, two-panel mosaic, resize during output, matching final PTY size, redraw without refocus, history and input preservation');
} finally { await browser.close(); }
