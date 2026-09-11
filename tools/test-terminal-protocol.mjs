// npm run build, then node tools/test-terminal-protocol.mjs
// Exercise the actual Vite/Rollup/minified xterm chunk shipped in the app.
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const assets = await readdir('dist/assets');
const chunk = assets.find(name => /^xterm-.*\.js$/.test(name));
if (!chunk) throw new Error('Run npm run build first');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route('http://tessera.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body:
      '<div id="terminal" style="width:800px;height:400px"></div>' });
    if (/^\/assets\/[\w.-]+\.js$/.test(path)) return route.fulfill({
      path: resolve('dist', path.slice(1)), contentType: 'text/javascript',
    });
    return route.abort();
  });
  await page.goto('http://tessera.test/');
  await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' });
  const helper = await build({ entryPoints: ['src/lib/terminalResize.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'TesseraResize' });
  await page.addScriptTag({ content: helper.outputFiles[0].text });
  const result = await page.evaluate(async chunk => {
    const exports = Object.values(await import(`/assets/${chunk}`));
    const Terminal = exports.find(value => value.prototype?.open && value.prototype?.write);
    const FitAddon = exports.find(value => value.prototype?.fit && value.prototype?.proposeDimensions);
    if (!Terminal || !FitAddon) throw new Error('Production terminal exports missing');
    const terminal = new Terminal({ cols: 80, rows: 20, windowsPty: { backend: 'conpty', buildNumber: 26200 } });
    const host = document.getElementById('terminal');
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    const frames = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
    const write = data => new Promise(resolve => terminal.write(data, resolve));
    await write('completed frame'); await frames();
    const replies = [];
    terminal.onData(data => replies.push(data));
    // Codex probes these modes on startup. This also catches ESM/minifier
    // regressions that do not reproduce in the development UMD test bundle.
    await write('\x1b[?2026$p\x1b[?25$p\x1b[6n');
    let renders = 0;
    const rendering = terminal.onRender(() => renders++);
    await write('\x1b[?2026h\x1b[Hpartial frame'); await frames();
    await write('\x1b[2;1Hmore partial output'); await frames();
    const partialRenders = renders;
    await write('\x1b[?2026l'); await frames();
    const completedRenders = renders;
    rendering.dispose();
    await write('\x1b[3J\x1b[2J\x1b[H' + Array.from({ length: 200 }, (_, i) => `row ${i}`).join('\r\n'));
    const baseBefore = terminal.buffer.normal.baseY;
    terminal.resize(80, 30);
    const conptyGrowthAppendsRows = terminal.buffer.normal.baseY === baseBefore;
    // Full-screen apps, wide cells, hyperlinks and wrapped transcript reflow
    // continue through the unmodified production parser after the upgrade.
    await write('\x1b[?1049h\x1b[2J\x1b[Hmenu 中\x1b[?1049l');
    await write('\r\n' + 'long wrapped line '.repeat(10));
    for (const [cols, rows] of [[40, 10], [100, 40], [60, 24], [80, 20]]) {
      terminal.resize(cols, rows);
      await write('\r\n\x1b]8;;https://example.com\x07link\x1b]8;;\x07');
      await frames();
    }
    const bufferValid = terminal.buffer.normal.length >= terminal.rows &&
      Array.from({ length: terminal.buffer.normal.length }, (_, i) => !!terminal.buffer.normal.getLine(i)).every(Boolean);

    const nativeCalls = [];
    let finish;
    const sizing = window.TesseraResize.createTerminalResize(terminal, fit, (cols, rows) => {
      nativeCalls.push({ cols, rows });
      return new Promise(resolve => { finish = resolve; });
    });
    const initial = sizing.fitNow();
    const noResizeBeforeSpawn = nativeCalls.length === 0;
    sizing.ready(initial);
    for (let i = 0; i < 5; i++) sizing.requestFit();
    await frames();
    const sameSizeIgnored = nativeCalls.length === 0;
    host.style.width = '650px'; sizing.requestFit(); await frames();
    host.style.width = '580px'; sizing.requestFit();
    host.style.width = '500px'; sizing.requestFit(); await frames();
    const oneResizeInFlight = nativeCalls.length === 1;
    const finalSize = { cols: terminal.cols, rows: terminal.rows };
    finish(); await frames();
    const coalescedLatestSize = nativeCalls.length === 2 &&
      JSON.stringify(nativeCalls[1]) === JSON.stringify(finalSize);
    finish(); await frames();
    host.style.display = 'none'; sizing.requestFit(); await frames();
    const hiddenGeometryIgnored = nativeCalls.length === 2 &&
      terminal.cols === finalSize.cols && terminal.rows === finalSize.rows;
    host.style.display = ''; sizing.requestFit(); await frames();
    const visibilityDoesNotResize = nativeCalls.length === 2;
    host.style.width = '700px'; sizing.requestFit(); sizing.dispose(); await frames();
    const disposedFitCancelled = nativeCalls.length === 2;
    terminal.dispose();
    return { replies, partialRenders, completedRenders, conptyGrowthAppendsRows, bufferValid,
      noResizeBeforeSpawn, sameSizeIgnored, oneResizeInFlight, coalescedLatestSize,
      hiddenGeometryIgnored, visibilityDoesNotResize, disposedFitCancelled };
  }, chunk);
  const { replies, partialRenders, completedRenders, ...checks } = result;
  expect(replies).toContain('\x1b[?2026;2$y');
  expect(replies).toContain('\x1b[?25;1$y');
  expect(replies).toContain('\x1b[1;16R');
  expect(partialRenders).toBe(0);
  expect(completedRenders).toBe(1);
  for (const [name, passed] of Object.entries(checks)) expect(passed, name).toBe(true);
  expect(errors).toEqual([]);
  console.log(`PASS production ${chunk}: mode probes/CPR, zero partial synchronized frames, ConPTY row growth, reflow and alternate screens`);
  console.log('PASS resize lifecycle: spawn ordering, unchanged/hidden geometry, one in flight, latest size coalescing and disposal');
} finally { await browser.close(); }
