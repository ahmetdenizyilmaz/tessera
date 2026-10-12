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
  const pathOpens = () => page.evaluate(() => window.calls.filter(c => c.command === 'open_path_smart'));
  const clickText = async (text, path = false) => {
    const link = page.locator('[data-panel-id="codex-ui"] .xterm-rows').getByText(text, { exact: true });
    await expect(link).toBeVisible();
    // xterm's screen handles mouse events; its text spans are pointer-events:none.
    const box = await link.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    if (path) await expect(page.locator('[data-panel-id="codex-ui"] .xterm')).toHaveAttribute('title', /(?:Open folder|Show file in folder):/);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.mouse.click(x, y);
  };
  const plain = 'https://example.com/plain?q=one&other=two#section';
  const explicit = 'https://example.com/explicit?q=one&other=two#section';
  await page.evaluate(() => {
    window.pathFixtures = { 'C:\\scratch|file:///C:/test.txt': { path: 'C:\\test.txt', isDir: false, base: 'absolute' } };
  });
  await page.locator('[data-panel-id="codex-ui"] .xterm-helper-textarea').focus();
  await write(`\x1b[2J\x1b[H${plain}\r\n\x1b]8;;${explicit}\x1b\\Documentation\x1b]8;;\x1b\\\r\n\x1b]8;;file:///C:/test.txt\x1b\\Local file\x1b]8;;\x1b\\`);
  await clickText(plain);
  await expect.poll(async () => (await opens()).map(c => c.args.path)).toEqual([plain]);
  await clickText('Documentation');
  await expect.poll(async () => (await opens()).map(c => c.args.path)).toEqual([plain, explicit]);
  await clickText('Local file');
  expect((await opens()).map(c => c.args.path)).toEqual([plain, explicit]);
  await expect.poll(async () => (await pathOpens()).map(c => c.args.path)).toEqual(['file:///C:/test.txt']);
  expect(await page.evaluate(() => [window.popups, window.confirmations])).toEqual([0, 0]);
  console.log('PASS web URLs retain native browser opening; OSC 8 file links use the validated filesystem opener');

  for (const [text, path, isDir] of [
    ['src/assets', 'src/assets', true], ['../shared/art', '../shared/art', true],
    ['C:\\Work\\Images', 'C:\\Work\\Images', true], ['"C:/Work/My Files"', 'C:/Work/My Files', true],
    ['`outputs`', 'outputs', true], ['file:///C:/My%20Files', 'file:///C:/My%20Files', true],
    ['src/app.ts:12:3', 'src/app.ts:12:3', false],
  ]) {
    await page.evaluate(({ path, isDir }) => { window.pathFixtures[`C:\\scratch|${path}`] = { path: `C:\\resolved\\${path}`, isDir, base: 'cwd' }; }, { path, isDir });
    await page.mouse.move(0, 0);
    await write(`\x1b[2J\x1b[H${text}`);
    const count = (await pathOpens()).length;
    await clickText(text, true);
    await expect.poll(async () => (await pathOpens()).length).toBe(count + 1);
    expect((await pathOpens()).at(-1).args).toEqual({ path, cwd: 'C:\\scratch' });
  }
  await write('\x1b[2J\x1b[Hmissing/folder');
  await page.mouse.move(0, 0);
  const count = (await pathOpens()).length;
  await clickText('missing/folder');
  expect((await pathOpens()).length).toBe(count);
  await write('\x1b[2J\x1b[H\x1b]8;;javascript:alert(1)\x1b\\Unsafe scheme\x1b]8;;\x1b\\');
  await clickText('Unsafe scheme');
  expect((await pathOpens()).length).toBe(count);
  expect((await opens()).length).toBe(2);

  const wrapped = await page.evaluate(() => `src/${'long'.repeat(Math.ceil(window.terminals.get('codex-ui').cols / 4))}/資料/cafe\u0301`);
  await page.evaluate(path => { window.pathFixtures[`C:\\scratch|${path}`] = { path: `C:\\scratch\\${path}`, isDir: true, base: 'cwd' }; }, wrapped);
  await write(`\x1b[2J\x1b[H界🙂 ${wrapped}`);
  const cell = await page.evaluate(() => {
    const term = window.terminals.get('codex-ui');
    for (let row = 0; row < term.rows; row++) for (let col = 0; col < term.cols; col++) {
      if (term.buffer.active.getLine(term.buffer.active.baseY + row)?.getCell(col)?.getChars() === '資') return { row, col, cols: term.cols, rows: term.rows };
    }
  });
  expect(cell).toBeTruthy();
  expect(cell.row).toBeGreaterThan(0);
  const screen = await page.locator('[data-panel-id="codex-ui"] .xterm-screen').boundingBox();
  const x = screen.x + (cell.col + .5) * screen.width / cell.cols;
  const y = screen.y + (cell.row + .5) * screen.height / cell.rows;
  await page.mouse.move(x, y);
  await expect(page.locator('[data-panel-id="codex-ui"] .xterm')).toHaveAttribute('title', `Open folder: C:\\scratch\\${wrapped}`);
  await page.mouse.click(x, y);
  await expect.poll(async () => (await pathOpens()).at(-1).args.path).toBe(wrapped);
  console.log('PASS existing relative/absolute/quoted paths, files, file URLs and wrapped Unicode paths; missing paths and unsafe schemes do not open');

  await page.evaluate(() => {
    window.pathFixtures['C:\\first|src/assets'] = { path: 'C:\\first\\src\\assets', isDir: true, base: 'cwd' };
    window.pathFixtures['D:\\second|src/assets'] = { path: 'D:\\second\\src\\assets', isDir: true, base: 'cwd' };
    window.pathFixtures['C:\\first|outputs'] = { path: 'C:\\first\\outputs', isDir: true, base: 'cwd' };
    window.showPathMarkdown([
      { cwd: 'C:\\first', content: 'See src/assets and missing/folder. Also `outputs` or [Open folder](src/assets).' },
      { cwd: 'D:\\second', content: 'See `src/assets`.' },
      { cwd: null, content: 'Remote: src/assets.' },
    ]);
  });
  const first = page.getByTestId('path-chat-0');
  const second = page.getByTestId('path-chat-1');
  await expect(first.getByRole('link')).toHaveCount(3);
  await expect(first.getByText('missing/folder.')).not.toHaveAttribute('role', 'link');
  await first.getByRole('link', { name: 'outputs', exact: true }).click();
  await expect.poll(async () => (await pathOpens()).at(-1).args).toEqual({ path: 'outputs', cwd: 'C:\\first' });
  await second.getByRole('link').click();
  await expect.poll(async () => (await pathOpens()).at(-1).args).toEqual({ path: 'src/assets', cwd: 'D:\\second' });
  await expect(page.getByTestId('path-chat-2').getByRole('link')).toHaveCount(0);
  console.log('PASS chat prose, inline code and Markdown folder links resolve in their own panels; remote paths do not open local lookalikes');
} finally { await browser.close(); }
