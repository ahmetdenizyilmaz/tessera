import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.context().on('page', p => p.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); }));
page.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); });
async function dragStart(p, selector, to) {
  const b = await p.locator(selector).boundingBox();
  await p.mouse.move(b.x + 30, b.y + 14); await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 10 });
}
try {
  await page.goto('http://127.0.0.1:1420/tools/window-fixture.html');
  await expect(page.locator('.tab-item')).toHaveCount(3);
  // Pulling off the strip offers a window, not the nearest group tab.
  await dragStart(page, '.tab-item:has-text("Timer")', { x: 400, y: 230 });
  await expect(page.locator('.window-drag-hint')).toHaveText('Release to open a new window');
  await expect(page.locator('.tab-item-drop-target')).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.window-drag-hint')).toHaveCount(0);
  expect(await page.evaluate(() => window.workspaces.getState().windows.length)).toBe(0);
  expect(await page.locator('html').getAttribute('data-tab-dragging')).toBeNull();

  // The source is still Main: the strip gesture alone must detach.
  const childPromise = page.waitForEvent('popup');
  await dragStart(page, '.tab-item:has-text("Timer")', { x: 400, y: 230 });
  await page.mouse.up();
  const child = await childPromise;
  await expect(child.locator('.detached-tab')).toHaveCount(1);
  const childLabel = await child.locator('html').getAttribute('data-workspace-window');
  // Show the marker before the first destination tab, then commit that order.
  await page.evaluate(label => { window.dropTarget = { label, x: 1600, y: 100, clientX: 10, clientY: 20 }; }, childLabel);
  await dragStart(page, '.tab-item:has-text("Lichess")', { x: 400, y: 230 });
  await expect(child.locator('[data-window-drop-marker]')).toHaveCount(1);
  await expect(child.locator('html')).toHaveAttribute('data-window-drop-target', '');
  await page.mouse.up();
  await expect(child.locator('.detached-tab')).toHaveCount(2);
  await expect(child.locator('.detached-tab').first()).toContainText('Lichess');
  await expect(child.locator('[data-window-drop-marker]')).toHaveCount(0);
  expect(await child.locator('html').getAttribute('data-window-drop-target')).toBeNull();

  // Local tab reordering remains available without triggering a detach.
  await page.evaluate(label => { window.dropTarget = { label, x: 1600, y: 100 }; }, childLabel);
  const first = await child.locator('.detached-tab').first().boundingBox();
  await dragStart(child, '.detached-tab:has-text("Timer")', { x: first.x + 20, y: first.y + 14 });
  await child.mouse.up();
  await expect(child.locator('.detached-tab').first()).toContainText('Timer');
  expect(await page.evaluate(() => window.workspaces.getState().windows.length)).toBe(1);

  // Drop into the group currently open in the child window, not its root.
  await child.getByTitle('Add a panel', { exact: true }).click();
  await child.getByRole('button', { name: 'New group', exact: true }).click();
  await child.getByTitle('Enter group').click();
  await expect(child.locator('.detached-tab')).toHaveCount(0);
  const nested = await child.locator('html').getAttribute('data-workspace-group');
  await page.evaluate(label => { window.dropTarget = { label, x: 1600, y: 100, clientX: 100, clientY: 20 }; }, childLabel);
  await dragStart(page, '.tab-item', { x: 400, y: 230 });
  await page.mouse.up();
  await expect(child.locator('.detached-tab')).toHaveCount(1);
  expect(await page.evaluate(id => window.groups.getState().groups.get(id).childIds.includes(window.group), nested)).toBe(true);
  // A header can also transfer out of a detached window.
  await child.getByTitle('Back to parent group').click();
  await child.locator('.detached-tab:has-text("Lichess")').click();
  await page.evaluate(() => { window.dropTarget = { label: 'main', x: 100, y: 100, clientX: 40, clientY: 20 }; });
  await dragStart(child, '.browser-title', { x: 400, y: 250 });
  await child.mouse.up();
  await expect(page.locator('.tab-item:has-text("Lichess")')).toBeVisible();
  expect(await page.evaluate(() => window.calls.some(c => c.command === 'browser_panel_close' && c.args.id === window.lichess))).toBe(false);
  expect(errors).toEqual([]);
  console.log('PASS tear-off threshold, Escape, no distant group target, insertion marker/order, child reorder, nested-group destination, detached header transfer');
} finally { await browser.close(); }
