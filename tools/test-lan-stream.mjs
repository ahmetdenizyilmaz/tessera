// Two independent real xterm/React renderers; mocked IPC, no user sessions.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const owner = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const viewer = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], frames = [];
let corrupt = false;
for (const page of [owner, viewer]) {
  page.on('pageerror', e => { if (e.message !== 'WebSocket closed without opened.') errors.push(e.message); });
  await page.route('**/lan-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import R from '/@react-refresh'; R.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script>
<script type="module" src="/tools/lan-ui-fixture.jsx"></script>` }));
}
await viewer.exposeFunction('readRemote', async (panelId, options) => {
  const frame = await owner.evaluate(({panelId, options}) => window.readSharedTerminal(panelId, options), {panelId, options});
  frames.push({ panelId, kind: frame.kind, size: JSON.stringify(frame).length, events: frame.events?.length ?? 0 });
  if (corrupt && frame.kind === 'terminalDelta' && frame.events?.length) {
    corrupt = false; frame.events[0].sequence += 10;
  }
  return { ...frame, inputSession: `pty-${panelId}`, connectionId: 'stream-connection' };
});
const state = (page, id = 'host-claude') => page.evaluate(id => {
  const t = window.terminals.get(id), b = t.buffer.active;
  return { cols: t.cols, rows: t.rows, type: b.type, cursorX: b.cursorX, cursorY: b.cursorY,
    lines: Array.from({length:b.length}, (_,i)=>b.getLine(i)?.translateToString(true)),
    color: b.getLine(0)?.getCell(0)?.getFgColor() };
}, id);
const equal = async (id = 'host-claude') => expect.poll(async () => state(viewer, id)).toEqual(await state(owner, id));
try {
  for (const page of [owner, viewer]) {
    await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/lan-test`);
    await page.waitForFunction(() => !!window.showOwner);
  }
  await owner.evaluate(() => window.showOwner());
  await expect.poll(() => owner.evaluate(() => window.calls.filter(c => ['pty_spawn','codex_terminal_spawn'].includes(c.command)).length)).toBe(2);
  await owner.evaluate(async () => {
    window.terminals.get('host-claude').resize(18,8);
    await window.output('host-claude','\x1b[31mBefore connecting\x1b[0m\r\nready> ');
    await window.output('host-codex','\x1b[?1049h\x1b[2J\x1b[HAlternate screen');
  });
  await viewer.evaluate(() => { window.setStreamSupported(true); window.showViewer(); });
  await viewer.locator('[data-fixture-id="host-claude"]').evaluate(n => { n.style.width='850px'; });
  await viewer.evaluate(() => window.focusRemote('host-claude'));
  await expect.poll(async () => (await state(owner)).cols).toBeGreaterThan(80);
  await equal(); await equal('host-codex');
  expect(await owner.evaluate(() => window.calls.some(c => c.command==='pty_resize' && c.args.inputSession==='pty-host-claude'))).toBe(true);
  console.log('PASS tiny host terminal fits the focused remote panel; both renderers agree on geometry and text');

  const checkpoints = frames.filter(f => f.panelId==='host-claude' && f.kind==='terminal').length;
  await owner.evaluate(async () => { await window.output('host-claude','\r\n\x1b[3'); });
  await expect.poll(() => frames.filter(f => f.kind==='terminalDelta'&&f.events>0).length).toBeGreaterThan(0);
  await owner.evaluate(async () => { await window.output('host-claude','2mÜnye 漢字\x1b[0m\r\nnext> '); });
  await expect.poll(async () => (await state(viewer)).lines.join('\n')).toContain('Ünye 漢字');
  await equal();
  expect(frames.filter(f => f.panelId==='host-claude'&&f.kind==='terminal').length).toBe(checkpoints);
  await expect.poll(() => frames.some(f => f.kind==='terminalDelta'&&!f.events&&f.size<400)).toBe(true);
  console.log('PASS incremental bytes preserve partial escape sequences and Unicode; idle frames carry no screen data');

  await owner.evaluate(() => window.output('host-codex','\r\n\x1b[36mLive alternate output\x1b[0m'));
  await expect.poll(async () => (await state(viewer,'host-codex')).lines.join('\n')).toContain('Live alternate output');
  await equal('host-codex');
  await viewer.locator('[data-fixture-id="host-claude"]').evaluate(n => { n.style.width='650px'; });
  await expect.poll(async () => (await state(owner)).cols).toBeLessThan(80);
  await equal();
  console.log('PASS live resizing and alternate-screen output stay synchronized');

  const beforeLocal = await state(owner);
  await owner.locator('[data-fixture-id="host-claude"] .xterm').dispatchEvent('pointerdown');
  await expect.poll(async () => (await state(owner)).cols).not.toBe(beforeLocal.cols);
  const localSize = (await state(owner)).cols;
  await expect(viewer.getByText('Another view controls the terminal size.',{exact:false})).toBeVisible();
  await viewer.waitForTimeout(1100);
  expect((await state(owner)).cols).toBe(localSize);
  await viewer.locator('[data-fixture-id="host-claude"] .remote-terminal').dispatchEvent('pointerdown');
  await expect.poll(async () => (await state(owner)).cols).toBe(beforeLocal.cols);
  await equal();
  console.log('PASS local interaction takes control without resize fights; remote click can reclaim it');

  corrupt = true;
  await owner.evaluate(() => window.output('host-claude','\r\nrecovered after a missing event'));
  await expect.poll(() => frames.filter(f=>f.panelId==='host-claude'&&f.kind==='terminal').length).toBeGreaterThan(checkpoints);
  await equal();
  await viewer.evaluate(() => window.setConnected(false));
  await owner.evaluate(() => window.output('host-claude','\r\noutput while disconnected'));
  await viewer.evaluate(() => window.setConnected(true));
  await expect.poll(async () => (await state(viewer)).lines.join('\n')).toContain('output while disconnected');
  await equal();
  console.log('PASS lost sequence and reconnect bootstrap safely without duplicating output');

  await owner.evaluate(() => window.showOwner(true));
  await viewer.locator('[data-fixture-id="host-claude"]').evaluate(n => { n.style.width='900px'; });
  await expect.poll(async () => (await state(owner)).cols).toBeGreaterThan(90);
  await owner.evaluate(() => window.output('host-claude','\r\nhidden and resized'));
  await expect.poll(async () => (await state(viewer)).lines.join('\n')).toContain('hidden and resized');
  await owner.evaluate(() => window.showOwner());
  await owner.locator('[data-fixture-id="host-claude"] .xterm').waitFor();
  await equal();
  console.log('PASS hidden host terminals keep streaming, resize and remount with their current state');

  const tile = viewer.locator('[data-fixture-id="host-claude"]');
  await tile.getByTitle('Show conversation history').click();
  await expect(tile.getByText('Actual chat transcript')).toBeVisible();
  await expect(tile.locator('.xterm')).toHaveCount(0);
  await tile.getByTitle('Show terminal').click();
  await expect(tile.locator('.xterm')).toBeVisible();
  await equal();
  await viewer.evaluate(() => window.setStreamSupported(false));
  await expect(tile.getByText('Update Tessera on the host PC',{exact:false})).toBeVisible();
  expect(await viewer.evaluate(() => window.calls.filter(c=>c.command==='lan_terminal_input'||c.command==='lan_send_panel'))).toEqual([]);
  expect(errors).toEqual([]);
  console.log('PASS history remains available, legacy hosts explain the update, and reading never sends input');
} finally { await browser.close(); }
