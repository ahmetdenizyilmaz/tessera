import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors = [];
context.on('page', p => p.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); }));
page.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); });
try {
  await page.goto('http://127.0.0.1:1420/tools/window-fixture.html');
  await expect(page.locator('.tab-item')).toHaveCount(3);
  // Main -> a new window through the real tab drag handler.
  await page.evaluate(() => window.dropTarget = { label: null, x: 1450, y: 120 });
  const popupPromise = page.waitForEvent('popup');
  const tab = page.locator('.tab-item').filter({ hasText: 'Timer' });
  const box = await tab.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 12); await page.mouse.down();
  await page.mouse.move(1300, 300, { steps: 12 }); await page.mouse.up();
  const child = await popupPromise;
  await expect(child.locator('.detached-tab')).toHaveCount(1);
  await expect(page.locator('.tab-item')).toHaveCount(2);
  expect(await child.locator('.detached-tab').evaluate(el => getComputedStyle(el).cursor)).toBe('default');
  // Transfer another tab into the same window without closing its native view.
  await page.evaluate(() => window.windows.movePanelToWindow(window.lichess, window.workspaces.getState().windows[0]));
  await expect(child.locator('.detached-tab')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.views[window.lichess]?.label)).toMatch(/^workspace-/);
  // Host dialogs must open in the child document and hide its native website.
  await child.getByRole('button', { name: 'Move to group', exact: true }).click();
  await expect(child.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await child.keyboard.press('Escape');
  // New session creation belongs to this window; replacing its only wizard
  // must not close the window or strand a tab in Main.
  await child.getByTitle('Add a panel', { exact: true }).click();
  await child.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(child.locator('.detached-tab')).toHaveCount(3);
  await page.evaluate(() => {
    const wizard = Object.entries(window.layout.getState().widgetKinds).find(([,kind]) => kind === 'new-session')[0];
    window.creation.replaceWizard(wizard, (destination, replacingId) => window.creation.createPluginPanel('notepad', destination, replacingId));
  });
  await expect(child.locator('.detached-tab')).toHaveCount(3);
  await expect(child.locator('.detached-tab').filter({ hasText: 'Notepad' })).toBeVisible();
  await expect(page.locator('.tab-item')).toHaveCount(1);
  // A second detached window accepts transfers and returns a live browser.
  const secondPromise = page.waitForEvent('popup');
  await page.evaluate(() => window.windows.detachPanel(window.lichess));
  const second = await secondPromise;
  await expect(second.locator('.detached-tab')).toHaveCount(1);
  await page.evaluate(() => window.windows.movePanelToWindow(window.timer, window.workspaces.getState().windows[1]));
  await expect(second.locator('.detached-tab')).toHaveCount(2);
  await page.evaluate(() => window.windows.movePanelToWindow(window.lichess, null));
  await expect.poll(() => page.evaluate(() => window.views[window.lichess]?.label)).toBe('main');
  expect(await page.evaluate(() => window.calls.some(c => c.command === 'browser_panel_close' && c.args.id === window.lichess))).toBe(false);
  await page.evaluate(() => window.windows.closeDetachedWorkspace(window.workspaces.getState().windows[1].id));
  await expect.poll(() => second.isClosed()).toBe(true);
  expect(await page.evaluate(() => window.plugins.getState().instances.has(window.timer))).toBe(false);
  // Moving the last tab closes only its empty window, preserving the panel.
  await page.evaluate(() => {
    const w = window.workspaces.getState().windows[0];
    window.windows.movePanelToWindow(window.groups.getState().groups.get(w.groupId).childIds[0], null);
  });
  await expect.poll(() => child.isClosed()).toBe(true);
  expect(await page.evaluate(() => window.workspaces.getState().windows.length)).toBe(0);
  expect(errors).toEqual([]);
  console.log('PASS detach, merge, transfer, browser retention, child dialogs, creation, close contents, empty-window cleanup, arrow cursor');
} finally { await browser.close(); }
