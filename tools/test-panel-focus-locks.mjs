import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage(), errors = [];
const observe = p => p.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); });
observe(page); context.on('page', observe);
const settle = p => p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'));
const shape = () => page.evaluate(() => [...window.layout.getState().panelRects.values()].map(r => JSON.stringify(r)).sort());
const tile = (p, id) => p.locator(`[data-panel-id="${id}"]`);
const focus = async (p, id) => { await p.locator(`[data-tab-id="${id}"]`).click(); await settle(p); };
async function drag(gutter, dx, dy) {
  const bounds = await gutter.boundingBox();
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up();
  await settle(page);
}
try {
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:1420'}/tools/window-fixture.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.tab-item')).toHaveCount(3);
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) window.creation.createPluginPanel('notepad');
    window.layout.getState().setFocused(window.lichess);
  });
  await expect(page.locator('.mosaic-tile')).toHaveCount(7); await settle(page);
  const ids = await page.evaluate(() => window.layout.getState().tabOrder);
  const lichess = await page.evaluate(() => window.lichess);
  const group = await page.evaluate(() => window.group);
  for (const id of ids) await expect(tile(page, id).getByRole('button', { name: 'Lock panel position', exact: true })).toHaveCount(1);
  const workspace = await page.locator('.mosaic-container').boundingBox();
  const mainDividerIndex = await page.locator('.mosaic-gutter-x').evaluateAll(gutters => gutters.reduce((best, el, i) => el.getBoundingClientRect().height > gutters[best].getBoundingClientRect().height ? i : best, 0));
  await drag(page.locator('.mosaic-gutter-x').nth(mainDividerIndex), -workspace.width * .25, 0);
  const footerIndex = await page.locator('.mosaic-gutter-y').evaluateAll(gutters => gutters.reduce((best, el, i) => el.getBoundingClientRect().width > gutters[best].getBoundingClientRect().width ? i : best, 0));
  await drag(page.locator('.mosaic-gutter-y').nth(footerIndex), 0, workspace.height * .08);
  const bottomIndex = await page.locator('.mosaic-gutter-x').evaluateAll(gutters => gutters.findIndex(el => el.getBoundingClientRect().height < innerHeight * .2));
  expect(bottomIndex).toBeGreaterThanOrEqual(0);
  await drag(page.locator('.mosaic-gutter-x').nth(bottomIndex), workspace.width * .06, 0);
  const resized = await shape();
  expect(await page.evaluate(() => !!window.layout.getState().layoutConfig.slotRects)).toBe(true);
  for (const id of ids) { await focus(page, id); expect(await shape()).toEqual(resized); }
  console.log('PASS real pointer resizing of main, footer, and internal footer dividers; all dividers stay fixed through tab focus');

  const pinned = (await page.evaluate(() => window.layout.getState().layoutConfig.panelOrder)).filter(id => id !== lichess).slice(2, 4);
  const beforeFocus = await page.evaluate(() => window.layout.getState().focusedId);
  for (const id of pinned) await tile(page, id).getByRole('button', { name: 'Lock panel position', exact: true }).click();
  expect(await page.evaluate(() => window.layout.getState().focusedId)).toBe(beforeFocus);
  const pinnedRects = await page.evaluate(ids => ids.map(id => window.layout.getState().panelRects.get(id)), pinned);
  for (const id of ids.filter(id => !pinned.includes(id))) {
    await focus(page, id);
    expect(await page.evaluate(ids => ids.map(id => window.layout.getState().panelRects.get(id)), pinned)).toEqual(pinnedRects);
    expect(await shape()).toEqual(resized);
  }
  await focus(page, pinned[0]);
  expect(await page.evaluate(() => window.layout.getState().layoutConfig.panelOrder[0])).toBe(pinned[0]);
  await focus(page, ids.find(id => !pinned.includes(id)));
  expect(await page.evaluate(id => window.layout.getState().panelRects.get(id), pinned[1])).toEqual(pinnedRects[1]);
  await page.screenshot({ path: '../tessera-office-validation/panel-position-locks.png' });
  const saved = await page.evaluate(() => window.serializeWorkspace());
  expect(saved.lockedPanelIds.sort()).toEqual(pinned.sort());
  await page.evaluate(saved => window.deserializeWorkspace(saved), saved);
  await expect(tile(page, pinned[0]).getByRole('button', { name: 'Unlock panel position' })).toBeVisible();
  expect(await shape()).toEqual(resized);
  console.log('PASS pinning without focus changes, skipped locked slots, directly focusing a locked panel, main swapping, and workspace restore');

  const popup = page.waitForEvent('popup');
  await page.evaluate(() => window.windows.detachPanel(window.lichess));
  const child = await popup;
  await expect(child.locator('.detached-tab')).toHaveCount(1);
  const moveIds = ids.filter(id => id !== lichess && id !== group).slice(0, 4);
  await page.evaluate(ids => { const workspace = window.workspaces.getState().windows[0]; for (const id of ids) window.windows.movePanelToWindow(id, workspace); }, moveIds);
  await expect(child.locator('.detached-tab')).toHaveCount(5); await settle(child);
  const lock = tile(child, lichess).getByRole('button', { name: 'Lock panel position', exact: true });
  if (await lock.count()) await lock.click();
  const pinnedChild = await tile(child, lichess).boundingBox();
  await focus(child, moveIds[0]);
  const afterChild = await tile(child, lichess).boundingBox();
  for (const key of ['x', 'y', 'width', 'height']) expect(afterChild[key]).toBeCloseTo(pinnedChild[key], 0);
  await tile(child, lichess).getByRole('button', { name: 'Lichess view settings' }).click();
  const childMenu = child.getByRole('dialog', { name: 'Lichess view settings' });
  await expect(childMenu).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await childMenu.getByRole('button', { name: 'Live view' }).click();
  await expect.poll(() => page.evaluate(() => !!window.views[window.lichess]?.bounds)).toBe(true);
  await child.screenshot({ path: '../tessera-office-validation/detached-panel-locks.png' });
  console.log('PASS detached locks, shared web-app size preferences, child-document settings, and native browser bounds');
  expect(errors).toEqual([]);
} finally { await browser.close(); }
