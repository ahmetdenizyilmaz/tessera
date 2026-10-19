import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const base = process.argv[2] ?? 'http://127.0.0.1:1420';
const errors = [];
page.on('pageerror', e => { if (!e.message.includes('WebSocket closed without opened')) errors.push(e.message); });
await page.route(/\/browser-settings-test(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tools/browser-panel-fixture.jsx"></script>` }));
const shown = () => expect.poll(() => page.evaluate(() => !!window.views[window.lichess]?.bounds)).toBe(true);
const hidden = () => expect.poll(() => page.evaluate(() => window.views[window.lichess]?.bounds)).toBe(null);
const settings = () => page.getByRole('button', { name: 'Lichess view settings', exact: true });
const menu = () => page.getByRole('dialog', { name: 'Lichess view settings' });
const resize = async percent => {
  await page.evaluate(percent => window.layout.getState().setRawPanelRects(new Map([
    [window.lichess, { x: 0, y: 0, w: percent, h: 100 }],
    [window.gameGroup, { x: percent, y: 0, w: 100 - percent, h: 100 }],
  ])), percent);
  await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'));
};
try {
  await page.goto(`${base}/browser-settings-test`, { waitUntil: 'domcontentloaded' });
  await shown();
  await page.evaluate(() => window.layout.getState().setFocused(window.gameGroup));
  await hidden();
  const focused = await page.evaluate(() => window.layout.getState().focusedId);
  const created = await page.evaluate(() => window.calls.filter(c => c.command === 'browser_panel_create').length);
  await settings().click();
  await expect(menu()).toBeVisible();
  expect(await page.evaluate(() => window.layout.getState().focusedId)).toBe(focused);
  await expect(menu().getByRole('button', { name: 'Click to focus' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '../tessera-office-validation/browser-size-settings.png' });
  await menu().getByRole('button', { name: 'Live view' }).click();
  await shown();
  await resize(20); await hidden();
  await resize(30); await shown();
  await settings().click(); await hidden();
  await menu().getByRole('button', { name: 'Click to focus' }).click(); await hidden();
  await resize(32); await shown();
  await resize(50); await shown();
  await settings().click();
  await expect(menu().getByRole('button', { name: 'Live view' })).toBeDisabled();
  await expect(menu().getByRole('button', { name: 'Click to focus' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(menu()).toHaveCount(0); await shown();
  await expect(settings()).toBeFocused();
  expect(await page.evaluate(() => window.calls.filter(c => c.command === 'browser_panel_create').length)).toBe(created);
  console.log('PASS adjustable size cutoff, immediate bounds updates without reloading, unchanged focus, always-live large panels, and Escape');

  await page.reload({ waitUntil: 'domcontentloaded' }); await shown();
  await page.evaluate(() => window.layout.getState().setFocused(window.gameGroup));
  await resize(30); await hidden();
  await resize(32); await shown();
  await settings().click(); await menu().getByRole('button', { name: 'Reset to default size' }).click();
  await hidden();
  await settings().click();
  await expect(menu().getByRole('button', { name: 'Reset to default size' })).toBeDisabled();
  await page.mouse.click(4, 4); await expect(menu()).toHaveCount(0);
  console.log('PASS persistence after page reload, reset to defaults, and outside dismissal');

  await page.evaluate(() => {
    window.customSite = window.plugins.getState().addWebApp({ name: 'My player', url: 'https://example.test/player', icon: 'Music' });
    window.customA = window.plugins.getState().createInstance(window.customSite);
    window.customB = window.plugins.getState().createInstance(window.customSite);
    for (const id of [window.customA, window.customB]) window.layout.getState().addPanel(id, 'plugin');
    window.layout.getState().setFocused(window.gameGroup);
    window.layout.getState().setRawPanelRects(new Map([
      [window.gameGroup, { x: 0, y: 0, w: 60, h: 100 }],
      [window.lichess, { x: 60, y: 0, w: 40, h: 50 }],
      [window.customA, { x: 60, y: 50, w: 20, h: 50 }],
      [window.customB, { x: 80, y: 50, w: 20, h: 50 }],
    ]));
  });
  await expect.poll(() => page.evaluate(() => Object.keys(window.views).length)).toBe(3);
  const customSettings = page.getByRole('button', { name: 'My player view settings', exact: true });
  await expect(customSettings.first()).toBeVisible();
  await customSettings.first().click();
  await page.getByRole('dialog', { name: 'My player view settings' }).getByRole('button', { name: 'Live view' }).click();
  await expect.poll(() => page.evaluate(() => [!!window.views[window.customA]?.bounds, !!window.views[window.customB]?.bounds, !!window.views[window.lichess]?.bounds])).toEqual([true, true, false]);
  await customSettings.last().click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Live view' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Click to focus' }).click();
  await expect.poll(() => page.evaluate(() => [window.views[window.customA]?.bounds, window.views[window.customB]?.bounds])).toEqual([null, null]);
  await page.setViewportSize({ width: 600, height: 650 });
  await customSettings.first().click();
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(600);
  await page.screenshot({ path: '../tessera-office-validation/browser-size-settings-narrow.png' });
  console.log('PASS settings shared by copies of a custom app, app isolation, narrow toolbar access, and popup clipping');

  await page.setViewportSize({ width: 1400, height: 900 });
  for (const [app, title] of [['html-tessera.game-radius-raid', 'Radius Raid'], ['html-tessera.game-menja', 'Menja'], ['html-tessera.game-onoff', 'ONOFF']]) {
    await page.goto(`${base}/browser-settings-test?app=${app}`, { waitUntil: 'domcontentloaded' });
    await shown();await page.evaluate(() => window.layout.getState().setFocused(window.gameGroup));await hidden();
    const gameSettings = () => page.getByRole('button', { name: `${title} view settings`, exact: true });
    const gameMenu = () => page.getByRole('dialog', { name: `${title} view settings` });
    await gameSettings().click();await gameMenu().getByRole('button', { name: 'Live view' }).click();
    await expect(gameMenu()).toHaveCount(0);await shown();
    expect(await page.evaluate(app => JSON.parse(localStorage.getItem('tessera-browser-views')).preferences[app].mode, app)).toBe('live');
    await page.reload({ waitUntil: 'domcontentloaded' });await shown();
    await page.evaluate(() => window.layout.getState().setFocused(window.gameGroup));await shown();
    await gameSettings().click();await expect(gameMenu().getByRole('button', { name: 'Live view' })).toHaveAttribute('aria-pressed', 'true');
    await gameMenu().getByRole('button', { name: 'Click to focus' }).click();await hidden();
    await gameSettings().click();await gameMenu().getByRole('button', { name: 'Reset to default size' }).click();await hidden();
    expect(await page.evaluate(app => JSON.parse(localStorage.getItem('tessera-browser-views')).preferences[app], app)).toBeUndefined();
    console.log(`PASS ${title} small-panel Live view, saved preference after reload, Click to focus, and reset`);
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
