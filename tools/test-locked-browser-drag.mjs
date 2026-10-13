import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); });
const settle = () => page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'));
const live = () => expect.poll(() => page.evaluate(() => !!window.views[window.lichess]?.bounds)).toBe(true);
const neverHidden = async () => expect(await page.evaluate(() => window.calls.filter(c =>
  c.command === 'browser_panel_bounds' && c.args.id === window.lichess && c.args.bounds === null))).toEqual([]);
try {
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:1420'}/tools/window-fixture.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.tab-item')).toHaveCount(3);
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) window.creation.createPluginPanel('notepad');
    window.layout.getState().setFocused(window.timer);
  });
  await settle();
  const id = await page.evaluate(() => window.lichess);
  const tile = page.locator(`[data-panel-id="${id}"]`);
  await tile.getByRole('button', { name: 'Lock panel position', exact: true }).click();
  await tile.getByRole('button', { name: 'Lichess view settings' }).click();
  await page.getByRole('button', { name: 'Live view' }).click(); await live();
  const pinned = await page.evaluate(() => window.layout.getState().panelRects.get(window.lichess));
  await page.evaluate(() => { window.calls = []; });
  const others = await page.evaluate(() => window.layout.getState().tabOrder.filter(id => id !== window.lichess && id !== window.group));
  for (const other of others) { await page.locator(`[data-tab-id="${other}"]`).click(); await settle(); await live(); }
  await neverHidden();
  console.log('PASS locked live browser never disappears during focus rotation');

  const source = page.locator(`[data-panel-id="${others.at(-1)}"] .terminal-toolbar`).first();
  const header = await source.boundingBox(), ws = await page.locator('.mosaic-container').boundingBox();
  await page.mouse.move(header.x + 45, header.y + header.height / 2); await page.mouse.down();
  await page.mouse.move(ws.x + ws.width * .1, ws.y + ws.height * .5, { steps: 15 });
  await expect(page.locator('.snap-layout-preview')).toBeVisible();
  await expect(page.locator(`[data-preview-panel-id="${id}"]`)).toHaveCount(0);
  expect(await page.locator('.snap-layout-preview').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await live(); await neverHidden();
  await page.mouse.up(); await settle(); await live();
  expect(await page.evaluate(() => window.layout.getState().panelRects.get(window.lichess))).toEqual(pinned);
  await neverHidden();
  console.log('PASS panel drag preview leaves the locked browser uncovered and the drop keeps its position');

  await page.evaluate(() => { window.calls = []; });
  const footerIndex = await page.locator('.mosaic-gutter-y').evaluateAll(elements => elements.reduce((best, el, i) =>
    el.getBoundingClientRect().width > elements[best].getBoundingClientRect().width ? i : best, 0));
  const footer = await page.locator('.mosaic-gutter-y').nth(footerIndex).boundingBox();
  await page.mouse.move(footer.x + footer.width / 2, footer.y + footer.height / 2); await page.mouse.down();
  await page.mouse.move(footer.x + footer.width / 2, footer.y - 40, { steps: 10 }); await live();
  await page.mouse.up(); await settle(); await neverHidden();
  console.log('PASS resizing unrelated footer panels leaves the locked browser live');
  const mainIndex = await page.locator('.mosaic-gutter-x').evaluateAll(elements => elements.reduce((best, el, i) =>
    el.getBoundingClientRect().height > elements[best].getBoundingClientRect().height ? i : best, 0));
  const divider = await page.locator('.mosaic-gutter-x').nth(mainIndex).boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2); await page.mouse.down();
  await page.mouse.move(divider.x - 45, divider.y + divider.height / 2, { steps: 10 });
  await expect.poll(() => page.evaluate(() => window.views[window.lichess]?.bounds)).toBe(null);
  await page.mouse.up(); await settle(); await live();
  console.log('PASS directly resizing the browser still captures the drag and restores its live view on release');
  await tile.getByRole('button', { name: 'Lichess view settings' }).click();
  await expect.poll(() => page.evaluate(() => window.views[window.lichess]?.bounds)).toBe(null);
  await page.keyboard.press('Escape'); await live();
  expect(errors).toEqual([]);
} finally { await browser.close(); }
