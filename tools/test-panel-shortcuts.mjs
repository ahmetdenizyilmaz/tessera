// npm run dev, then node tools/test-panel-shortcuts.mjs [http://127.0.0.1:1420]
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', error => {
  if (!error.message.includes('WebSocket closed without opened')) errors.push(error.message);
});
await page.route('**/panel-shortcuts-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/panel-shortcuts-fixture.jsx"></script>` }));
const bindings = () => page.evaluate(() => window.shortcuts.getState().bindings);
const focused = () => page.evaluate(() => window.layout.getState().focusedId);
const badge = page.locator('.panel-shortcut-badge');
const input = id => page.locator(`[data-panel-id="${id}"] textarea`).last();
const assign = async (id, key) => {
  await page.evaluate(id => window.focusPanel(id), id);
  await expect(input(id)).toBeAttached(); // xterm's input can be zero-sized by design.
  await input(id).focus();
  await page.keyboard.press(`Alt+${key}`);
};
try {
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/panel-shortcuts-test`);
  await expect(input('chat')).toBeEnabled();
  await page.waitForFunction(() => window.terminals.has('terminal'));
  await page.keyboard.down('Alt');
  await expect(badge).toHaveCount(2); // Only the focused unassigned panel's title and tab.
  await expect(badge.first()).toHaveText('Ctrl + ?');
  await expect(page.locator('.panel-shortcut-badge--assign')).toHaveCount(2);
  await expect(page.locator('[data-panel-id="chat"] .panel-shortcut-badge')).toHaveText('Ctrl + ?');
  await expect(page.locator('[data-panel-id="terminal"] .panel-shortcut-badge')).toHaveCount(0);
  await expect(badge.first()).toHaveCSS('color', 'rgb(239, 83, 80)');
  await page.evaluate(() => window.focusPanel('terminal'));
  await expect(badge).toHaveCount(2);
  await expect(page.locator('[data-panel-id="terminal"] .panel-shortcut-badge')).toHaveText('Ctrl + ?');
  await expect(page.locator('[data-panel-id="chat"] .panel-shortcut-badge')).toHaveCount(0);
  await page.evaluate(() => window.focusPanel('chat'));
  await expect(page.locator('[data-panel-id="chat"] .panel-shortcut-badge')).toHaveText('Ctrl + ?');
  await page.keyboard.press('1'); // Assign without releasing Alt: ? becomes the actual number.
  await expect(page.locator('[data-panel-id="chat"] .panel-shortcut-badge')).toHaveText('Ctrl + 1');
  await page.evaluate(() => window.focusPanel('terminal'));
  await expect(badge).toHaveCount(4); // Assigned chat stays visible; only focused terminal gets ?.
  await expect(page.locator('[data-panel-id="terminal"] .panel-shortcut-badge')).toHaveText('Ctrl + ?');
  await page.keyboard.up('Alt');
  await expect(badge).toHaveCount(0);
  await assign('chat', '1');
  await assign('terminal', '2');
  expect(await bindings()).toEqual({ 1: 'chat', 2: 'terminal' });
  await expect(badge).toHaveCount(0);
  const header = page.locator('[data-panel-id="terminal"] .agent-panel-toolbar');
  const before = await header.boundingBox();
  await page.evaluate(() => { window.calls = []; });
  await page.keyboard.down('Control');
  await expect(badge).toHaveCount(4); // Panel titles and tabs.
  await expect(page.locator('[data-panel-id="chat"] .panel-shortcut-badge')).toHaveText('Ctrl + 1');
  await expect(page.locator('[data-panel-id="terminal"] .panel-shortcut-badge')).toHaveText('Ctrl + 2');
  await expect(page.locator('.tab-item .panel-shortcut-badge').first()).toHaveCSS('font-size', '8px');
  expect((await page.locator('.tab-item .panel-shortcut-badge').first().boundingBox()).width).toBeLessThan(40);
  await expect(page.locator('.panel-shortcut-badge--assign')).toHaveCount(0);
  expect((await header.boundingBox()).height).toBe(before.height);
  await page.screenshot({ path: '.tmp/panel-shortcuts-ctrl-held.png' });
  await page.keyboard.up('Control');
  await expect(badge).toHaveCount(0);
  await page.keyboard.down('Alt');
  await expect(page.locator('.panel-shortcut-badge--assign')).toHaveCount(4);
  await expect(badge.filter({ hasText: 'Ctrl + ?' })).toHaveCount(0);
  await expect(page.locator('[data-panel-id="chat"] .panel-shortcut-badge')).toHaveText('Ctrl + 1');
  await expect(page.locator('[data-panel-id="terminal"] .panel-shortcut-badge')).toHaveText('Ctrl + 2');
  for (const name of await page.locator('.tab-name').all()) {
    await expect(name).toBeVisible();
    expect((await name.boundingBox()).width, `Tab title ${await name.textContent()} should stay readable`).toBeGreaterThan(30);
  }
  for (const tab of await page.locator('.tab-item').all()) {
    if (await tab.locator('.panel-shortcut-badge').count() === 0) continue;
    const titleBox = await tab.locator('.tab-name').boundingBox();
    const badgeBox = await tab.locator('.panel-shortcut-badge').boundingBox();
    expect(badgeBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
  }
  await page.waitForTimeout(350); // Let existing mosaic animations finish before visual capture.
  await page.screenshot({ path: '.tmp/panel-shortcuts-alt-held.png' });
  await page.keyboard.up('Alt');
  await expect(badge).toHaveCount(0);
  expect(await page.evaluate(() => window.calls.filter(c => c.command === 'pty_resize'))).toEqual([]);
  console.log('PASS compact assigned labels and a focused-only Ctrl + ? hint that follows focus and disappears on assignment');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tessera-autosave') ?? '{}').panelShortcuts))
    .toEqual({ 1: 'chat', 2: 'terminal' });

  await page.keyboard.press('Control+1');
  await expect(input('chat')).toBeFocused();
  await page.keyboard.type('chat draft');
  await expect(input('chat')).toHaveValue('chat draft');
  await page.keyboard.press('Control+2');
  await expect(input('terminal')).toBeFocused();
  expect(await page.evaluate(() => window.calls.filter(c => c.command === 'pty_write'))).toEqual([]);
  await page.keyboard.type('terminal draft');
  expect(await page.evaluate(() => window.calls.filter(c => c.command === 'pty_write').map(c => c.args.data).join(''))).toBe('terminal draft');
  await page.keyboard.press('Alt+1');
  expect(await bindings()).toEqual({ 1: 'terminal' });
  await assign('chat', '0');
  await page.evaluate(() => window.layout.getState().moveTab(0, 1));
  await page.keyboard.press('Control+1');
  await expect(input('terminal')).toBeFocused();
  await page.evaluate(() => window.layout.getState().toggleMaximized('terminal'));
  await page.keyboard.press('Control+0');
  await expect(input('chat')).toBeFocused();
  expect(await page.evaluate(() => window.layout.getState().maximizedId)).toBe('chat');
  await page.evaluate(() => window.layout.getState().toggleMaximized('chat'));
  console.log('PASS shortcuts move the typing cursor, never send their keystrokes, reassign uniquely, and survive reorder/maximize');

  await assign('nested', '3');
  await page.keyboard.press('Control+0');
  await expect(input('chat')).toBeFocused();
  await expect(input('chat')).toHaveValue('chat draft');
  await page.keyboard.press('Control+3');
  await expect(input('nested')).toBeFocused();
  expect(await focused()).toBe('nested');
  await page.keyboard.press('Control+1');
  await expect(input('terminal')).toBeFocused();
  expect(await page.evaluate(() => window.groups.getState().groupStack)).toEqual([]);
  console.log('PASS shortcuts navigate between groups and root panels without losing the chat draft');

  await input('chat').evaluate(node => { node.disabled = true; setTimeout(() => { node.disabled = false; }, 500); });
  await page.keyboard.press('Control+0');
  await expect(input('chat')).toBeFocused();
  await page.keyboard.press('Control+1');
  await expect(input('terminal')).toBeFocused();
  console.log('PASS a slowly reconnecting composer receives focus when it becomes ready');
  await input('chat').evaluate(node => { node.disabled = true; setTimeout(() => { node.disabled = false; }, 500); });
  await page.keyboard.press('Control+0');
  await page.locator('[data-panel-id="terminal"]').getByTitle('Double-click to rename').click();
  await expect(input('chat')).toBeEnabled();
  await expect(input('chat')).not.toBeFocused();
  await page.keyboard.press('Control+1');
  await expect(input('terminal')).toBeFocused();

  await page.evaluate(() => {
    const dialog = document.createElement('div');
    dialog.className = 'dialog-overlay'; dialog.id = 'test-dialog';
    document.body.append(dialog);
  });
  await page.keyboard.press('Alt+8');
  await page.keyboard.press('Control+0');
  expect(await focused()).toBe('terminal');
  expect((await bindings())['8']).toBeUndefined();
  await expect(badge).toHaveCount(0);
  await page.evaluate(() => document.getElementById('test-dialog').remove());
  await page.keyboard.down('Control');
  await expect(badge).not.toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(badge).toHaveCount(0);
  await page.keyboard.up('Control');
  await page.keyboard.down('Alt');
  await expect(page.locator('.panel-shortcut-badge--assign')).not.toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(badge).toHaveCount(0);
  await page.keyboard.up('Alt');
  await page.keyboard.press('Control+Alt+0');
  expect(await focused()).toBe('terminal');
  expect(await page.evaluate(() => {
    const e = new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, isComposing: true, cancelable: true });
    window.dispatchEvent(e); return e.defaultPrevented;
  })).toBe(false);
  await page.keyboard.press('Control+0');
  await expect(input('chat')).toBeFocused();
  await page.keyboard.press('Alt+Numpad4');
  expect(await bindings()).toEqual({ 1: 'terminal', 3: 'nested', 4: 'chat' });
  console.log('PASS modal dialogs, blur, IME, Ctrl+Alt, and numpad handling');

  await page.evaluate(() => window.closeAppForTest());
  await expect.poll(() => page.evaluate(() => window.calls.some(c => c.command === 'plugin:window|destroy'))).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tessera-autosave')).panelShortcuts))
    .toEqual({ 1: 'terminal', 3: 'nested', 4: 'chat' });
  await page.reload();
  await page.waitForFunction(() => Object.keys(window.shortcuts?.getState().bindings ?? {}).length === 3);
  const restored = await bindings();
  expect(restored['4']).not.toBe('chat');
  await page.keyboard.press('Control+4');
  await expect(input(restored['4'])).toBeFocused();
  await page.keyboard.press('Control+3');
  await expect(input(restored['3'])).toBeFocused();
  await expect(badge).toHaveCount(0);
  console.log('PASS real autosave and window-close save preserve bindings on restart and remap panel IDs, including group children');
  await page.locator(`[data-panel-id="${restored['3']}"]`).getByTitle('Close instance', { exact: true }).click();
  await expect.poll(async () => (await bindings())['3']).toBeUndefined();
  await page.keyboard.press('Control+4');
  await expect(input(restored['4'])).toBeFocused();
  console.log('PASS closing a panel frees its shortcut while other assignments keep working');
  const beforeFileSave = await bindings();
  await page.evaluate(() => window.showSaveLoad('save'));
  await page.getByRole('button', { name: 'Save...', exact: true }).click();
  await expect(page.getByText('Workspace saved successfully.')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(window.savedWorkspaceFile).workspace.panelShortcuts)).toEqual(beforeFileSave);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('Alt+8');
  expect((await bindings())['8']).toBe(beforeFileSave['4']);
  await page.evaluate(() => window.showSaveLoad('load'));
  await page.getByRole('button', { name: 'Load...', exact: true }).click();
  await expect(page.getByText('Workspace loaded successfully.')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const afterFileLoad = await bindings();
  expect(Object.keys(afterFileLoad)).toEqual(['1', '4']);
  expect(afterFileLoad['4']).not.toBe(beforeFileSave['4']);
  await page.keyboard.press('Control+4');
  await expect(input(afterFileLoad['4'])).toBeFocused();
  console.log('PASS Save Workspace / Load Workspace files preserve and restore panel shortcuts');
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
