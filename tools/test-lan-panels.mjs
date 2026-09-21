// npm run dev, then node tools/test-lan-panels.mjs [http://127.0.0.1:1420]
// Two independent browser contexts represent the two PCs. Real React/xterm,
// mocked native IPC; no user workspaces, network pairing or coding agents.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const owner = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const viewer = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
for (const page of [owner, viewer]) {
  page.on('pageerror', e => {
    // Vite's HMR socket is closed when the isolated page is replaced.
    if (e.message !== 'WebSocket closed without opened.') errors.push(e.message);
  });
  await page.route('**/lan-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/lan-ui-fixture.jsx"></script>` }));
}
let oldHost = false;
let snapshotOverride;
await viewer.exposeFunction('readRemote', async id => {
  if (oldHost) return { messages: [] };
  if (snapshotOverride) return snapshotOverride;
  return owner.evaluate(id => window.readSharedTerminal(id), id);
});
const terminalState = (page, id) => page.evaluate(id => {
  const t = window.terminals.get(id), b = t.buffer.active;
  return { cols: t.cols, rows: t.rows, cursorX: b.cursorX, cursorY: b.cursorY, type: b.type,
    lines: Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true)),
    color: b.getLine(0)?.getCell(0)?.getFgColor() };
}, id);
try {
  for (const page of [owner, viewer]) {
    await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/lan-test`);
    await page.waitForFunction(() => !!window.showOwner);
  }
  await owner.evaluate(() => window.showOwner());
  await expect.poll(() => owner.evaluate(() => window.calls.filter(c => ['pty_spawn', 'codex_terminal_spawn'].includes(c.command)).length)).toBe(2);
  await owner.evaluate(async () => {
    await window.output('host-claude', '\x1b[31mClaude terminal\x1b[0m\r\nwide: 漢字\r\n\x1b[6;8Hcursor here');
    await window.output('host-codex', '\x1b[?1049h\x1b[2J\x1b[H\x1b[32mCodex alternate screen\x1b[0m\r\nready');
  });
  await viewer.evaluate(() => window.showViewer());
  await expect(viewer.getByText('Actual chat transcript')).toBeVisible();
  for (const id of ['host-claude', 'host-codex']) {
    await expect.poll(async () => terminalState(viewer, id)).toEqual(await terminalState(owner, id));
  }
  expect(await viewer.evaluate(() => window.calls.some(c => c.command === 'lan_read_panel' && c.args.panelId !== 'host-chat'))).toBe(false);
  console.log('PASS both providers retain terminal geometry, Unicode, ANSI colors, cursor and alternate screen; chat stays chat');
  await viewer.screenshot({ path: '.tmp/lan-panel-fix-20260921.png', fullPage: true });

  await owner.evaluate(() => window.showOwner(true));
  await owner.locator('[data-fixture-id="host-claude"]').waitFor({ state: 'detached' });
  await owner.evaluate(() => window.output('host-claude', '\r\nHidden host output'));
  await expect.poll(async () => (await terminalState(viewer, 'host-claude')).lines.join('\n')).toContain('Hidden host output');
  await owner.evaluate(() => window.showOwner());
  await owner.locator('[data-fixture-id="host-claude"] .xterm').waitFor();
  await expect.poll(async () => terminalState(viewer, 'host-claude')).toEqual(await terminalState(owner, 'host-claude'));
  console.log('PASS hidden host panels continue updating and remount without changing identity');

  await viewer.evaluate(() => window.setConnected(false));
  await expect(viewer.getByText('Host PC is offline.', { exact: false }).first()).toBeVisible();
  await owner.evaluate(() => window.output('host-claude', '\r\nOutput while disconnected'));
  await viewer.evaluate(() => window.setConnected(true));
  await expect.poll(async () => (await terminalState(viewer, 'host-claude')).lines.join('\n')).toContain('Output while disconnected');
  await viewer.setViewportSize({ width: 800, height: 600 });
  expect(await viewer.evaluate(() => window.calls.filter(c => ['pty_spawn', 'codex_terminal_spawn', 'pty_resize', 'pty_write'].includes(c.command)))).toEqual([]);
  console.log('PASS reconnect catches up; remote rendering never spawns, types into, or resizes the host PTY');

  const stable = await terminalState(viewer, 'host-codex');
  oldHost = true;
  await expect(viewer.getByText('Update Tessera on the host computer to share terminal screens.', { exact: false }).first()).toBeVisible();
  expect(await terminalState(viewer, 'host-codex')).toEqual(stable);
  oldHost = false;
  snapshotOverride = { kind: 'terminal', cols: 0, rows: 40, data: '' };
  await expect(viewer.getByText('The host sent an invalid terminal screen.', { exact: false }).first()).toBeVisible();
  snapshotOverride = undefined;
  await expect(viewer.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('PASS outdated hosts and invalid frames show actionable errors and recover without chat fallback');

  await viewer.locator('[data-fixture-id="host-claude"]').getByRole('button', { name: 'Close remote panel locally' }).click();
  await expect(viewer.locator('[data-fixture-id="host-claude"]')).toHaveCount(0);
  await expect(viewer.locator('[data-fixture-id="host-codex"] .xterm')).toBeVisible();
  await viewer.evaluate(() => window.setConnected(false));
  await viewer.locator('[data-fixture-tab="lan:owner:host-chat"]').getByRole('button', { name: 'Close remote panel locally', exact: true }).click();
  await expect(viewer.getByText('Actual chat transcript')).toHaveCount(0);
  await viewer.evaluate(() => window.setConnected(true));
  await expect(viewer.getByRole('button', { name: 'Restore closed panels (2)', exact: true })).toBeVisible();
  expect(await viewer.evaluate(() => window.calls.filter(c => /kill|close|destroy|lan_disconnect|lan_forget|lan_send_panel/.test(c.command)))).toEqual([]);
  await viewer.reload();
  await viewer.waitForFunction(() => !!window.showViewer);
  await viewer.evaluate(() => window.showViewer());
  await expect(viewer.locator('[data-fixture-id="host-codex"] .xterm')).toBeVisible();
  await expect(viewer.locator('[data-fixture-id="host-claude"]')).toHaveCount(0);
  await expect(viewer.getByText('Actual chat transcript')).toHaveCount(0);
  await owner.evaluate(() => window.output('host-claude', '\r\nHost still running after viewer closed'));
  await viewer.getByRole('button', { name: 'Restore closed panels (2)', exact: true }).click();
  await expect(viewer.getByText('Actual chat transcript')).toBeVisible();
  await expect.poll(async () => (await terminalState(viewer, 'host-claude')).lines.join('\n')).toContain('Host still running after viewer closed');
  for (const page of [owner, viewer]) {
    expect(await page.evaluate(() => window.calls.filter(c => /kill|close|destroy|lan_disconnect|lan_forget|lan_send_panel/.test(c.command)))).toEqual([]);
  }
  expect(errors).toEqual([]);
  console.log('PASS tile/tab close stays local across offline, reconnect and reload; restore returns live screens without host teardown');

  await viewer.evaluate(() => window.showGroups());
  await viewer.locator('[data-fixture-group]').getByRole('button', { name: 'Close remote group locally', exact: true }).click();
  await expect(viewer.locator('[data-fixture-group]')).toHaveCount(0);
  await viewer.evaluate(() => { window.setConnected(false); window.setConnected(true); });
  expect(await viewer.evaluate(() => window.calls.filter(c => /kill|close|destroy|lan_disconnect|lan_forget|lan_send_panel/.test(c.command)))).toEqual([]);
  await viewer.reload();
  await viewer.waitForFunction(() => !!window.showGroups);
  await viewer.evaluate(() => window.showGroups());
  await expect(viewer.locator('[data-fixture-group]')).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Restore closed group', exact: true }).click();
  await expect(viewer.locator('[data-fixture-group]')).toHaveCount(1);
  await viewer.locator('[data-fixture-tab]').getByRole('button', { name: 'Close remote group locally', exact: true }).click();
  await expect(viewer.locator('[data-fixture-group]')).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Restore closed group', exact: true }).click();
  await viewer.evaluate(() => window.addLocalGroup());
  await expect(viewer.locator('[data-fixture-group]')).toHaveCount(2);
  await viewer.locator('[data-fixture-group]').first().scrollIntoViewIfNeeded();
  await viewer.screenshot({ path: '.tmp/lan-group-close-20260921.png', fullPage: true });
  await viewer.locator('[data-fixture-group]').getByRole('button', { name: 'Close group and all panels', exact: true }).click();
  const afterClose = await viewer.evaluate(() => window.workspaceState());
  expect(afterClose.groups).toHaveLength(1);
  expect(afterClose.order).toEqual(afterClose.groups);
  expect(afterClose.types['fixture-widget']).toBeUndefined();
  await viewer.locator('[data-fixture-group]').getByTitle('Enter group', { exact: true }).click();
  // Production MosaicLayout completes this navigation after its animation.
  await viewer.evaluate(async () => {
    const { useGroupStore } = await import('/src/store/groupStore.ts');
    useGroupStore.getState().commitEnterGroup();
  });
  await expect(viewer.locator('[data-fixture-id="host-claude"] .xterm')).toBeVisible();
  await expect(viewer.getByText('Actual chat transcript')).toBeVisible();
  await expect.poll(async () => terminalState(viewer, 'host-claude')).toEqual(await terminalState(owner, 'host-claude'));
  for (const page of [owner, viewer]) {
    expect(await page.evaluate(() => window.calls.filter(c => /kill|close|destroy|lan_disconnect|lan_forget|lan_send_panel/.test(c.command)))).toEqual([]);
  }
  expect(errors).toEqual([]);
  console.log('PASS group card/tab close hides the whole peer locally; restored groups retain live host panels, and local groups close nested children');
} finally { await browser.close(); }
