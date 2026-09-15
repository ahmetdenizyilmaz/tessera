// Long synchronized ConPTY redraws must stay visually atomic past xterm's
// one-second watchdog. Real renderer/parser, no CLI or user sessions.
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
try {
  await page.setContent('<div id="terminal"></div>');
  await page.addScriptTag({ path: 'node_modules/@xterm/xterm/lib/xterm.js' });
  await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' });
  const bundle = await build({ entryPoints: ['src/lib/terminalFrame.ts'], bundle: true, write: false, format: 'iife', globalName: 'TesseraFrame' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const t = window.terminal = new window.Terminal({ cols: 80, rows: 12, theme: { background: '#1a1a2e' } });
    t.open(document.getElementById('terminal'));
    window.guard = window.TesseraFrame.installTerminalFrameGuard(t);
    window.replies = [];
    t.onData(data => window.replies.push(data));
    window.write = data => new Promise(resolve => t.write(data, () => requestAnimationFrame(resolve)));
  });
  const write = data => page.evaluate(data => window.write(data), data);
  const snapshot = page.locator('.terminal-frame-snapshot');
  await write('Last complete view\r\n> input');
  await write('\x1b[?2026h\x1b[2J\x1b[Hfirst history page');
  await expect(snapshot).toHaveCount(0);
  await expect(snapshot).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Restoring view…');
  await expect(snapshot).toContainText('Last complete view');
  // Let the renderer's real watchdog expire, then deliver more history.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.terminal.modes.synchronizedOutputMode)).toBe(false);
  const heldImage = await page.locator('.xterm').screenshot();
  await write('\r\nintermediate history page\x1b[6n');
  expect((await page.locator('.xterm').screenshot()).equals(heldImage), 'Live history updates must remain covered by the last complete frame').toBe(true);
  await expect(snapshot).toContainText('Last complete view');
  await expect(snapshot).not.toContainText('intermediate history');
  expect(await page.evaluate(() => window.replies)).toEqual(['\x1b[2;26R']);
  expect(await snapshot.evaluate(node => ({ inert: node.inert, pointer: node.style.pointerEvents, helpers: node.querySelectorAll('textarea, input').length })))
    .toEqual({ inert: true, pointer: 'none', helpers: 0 });
  await write('\r\nlatest message\r\n> ready\x1b[?2026l');
  await expect(snapshot).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('.xterm-rows')).toContainText('latest message');
  // Short redraws have no extra DOM frame or animation delay.
  await write('\x1b[?2026h\r\nshort frame\x1b[?2026l');
  await page.waitForTimeout(850);
  await expect(snapshot).toHaveCount(0);
  // A user can always reveal live output, even if the CLI misses its end marker.
  await write('\x1b[?2026h\r\nlong redraw');
  await expect(snapshot).toBeVisible();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('x');
  await expect(snapshot).toHaveCount(0);
  expect(await page.evaluate(() => window.replies.at(-1))).toBe('x');
  await write('\x1b[?2026l');
  await page.clock.install();
  await write('\x1b[?2026h\r\nmissing end');
  await page.clock.runFor(850);
  await expect(snapshot).toBeVisible();
  await page.clock.fastForward(30000);
  await expect(snapshot).toHaveCount(0);
  await page.evaluate(() => { window.guard.dispose(); window.terminal.dispose(); });
  console.log('PASS long resume frames stay visually atomic after native watchdog; CPR, input, short frames, missing-end recovery and cleanup remain functional');
} finally { await browser.close(); }
