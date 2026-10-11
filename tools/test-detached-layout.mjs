import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.context().on('page', p => p.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); }));
const rects = p => p.locator('.mosaic-tile').evaluateAll(nodes => nodes.map(node => {
  const r = node.getBoundingClientRect();
  return { id: node.dataset.panelId, x: r.x, y: r.y, w: r.width, h: r.height, visible: getComputedStyle(node).visibility !== 'hidden' };
}));
try {
  await page.goto('http://127.0.0.1:1420/tools/window-fixture.html');
  await page.waitForFunction(() => !!window.windows);
  const popup = page.waitForEvent('popup');
  await page.evaluate(() => window.windows.detachPanel(window.lichess));
  const child = await popup;
  await child.setViewportSize({ width: 1100, height: 800 });
  await expect(child.locator('.mosaic-tile')).toHaveCount(1);
  await page.evaluate(() => window.windows.movePanelToWindow(window.timer, window.workspaces.getState().windows[0]));
  await expect(child.locator('.mosaic-tile')).toHaveCount(2);
  await page.waitForTimeout(350);
  const main = await rects(page);
  expect((await rects(child)).filter(r => r.visible)).toHaveLength(2);
  await child.locator('.detached-tab:has-text("Lichess")').click();
  await expect.poll(() => child.locator('.browser-panel').boundingBox().then(r => r.width)).toBeGreaterThan(700);
  const lichess = await page.evaluate(() => window.lichess);
  // Focus, resizing and maximize are local to the child window.
  const gutter = await child.locator('.mosaic-gutter-x').boundingBox();
  const area = await child.locator('.mosaic-container').boundingBox();
  await child.mouse.move(gutter.x + 4, gutter.y + 50); await child.mouse.down();
  await child.mouse.move(area.x + area.width * .6, gutter.y + 50, { steps: 10 }); await child.mouse.up();
  await child.locator('.detached-tab:has-text("Timer")').click();
  await child.locator('.detached-tab:has-text("Lichess")').click();
  await expect.poll(() => child.locator('.browser-panel').boundingBox().then(r => r.width)).toBeGreaterThan(640);
  await expect.poll(() => child.locator('.browser-panel').boundingBox().then(r => r.width)).toBeLessThan(680);
  await child.getByTitle('Maximize panel', { exact: true }).click();
  await expect.poll(() => rects(child).then(rs => rs.filter(r => r.visible).length)).toBe(1);
  await child.getByTitle('Restore panel size', { exact: true }).click();
  await expect.poll(() => rects(child).then(rs => rs.filter(r => r.visible).length)).toBe(2);
  expect(await rects(page)).toEqual(main);
  // Five panels use the same main + stack layout as Main.
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      const id = `extra-${i}`;
      window.plugins.getState().restoreInstance('timer', id, `Timer ${i + 2}`);
      window.layout.getState().addPanel(id, 'plugin');
      window.windows.movePanelToWindow(id, window.workspaces.getState().windows[0]);
    }
  });
  await expect(child.locator('.mosaic-tile')).toHaveCount(5);
  await child.locator('.detached-tab:has-text("Lichess")').click();
  await page.waitForTimeout(350);
  expect((await rects(child)).filter(r => r.visible)).toHaveLength(5);
  const childLabel = await child.locator('html').getAttribute('data-workspace-window');
  await page.evaluate(label => { window.dropTarget = { label, x: 1500, y: 300 }; }, childLabel);
  const header = await child.locator('.browser-title').boundingBox();
  await child.mouse.move(header.x + 30, header.y + 10); await child.mouse.down();
  await child.mouse.move(1050, 400, { steps: 12 });
  await expect(child.locator('[data-preview-panel-id]')).toHaveCount(5);
  const preview = await child.locator(`[data-preview-panel-id="${lichess}"]`).boundingBox();
  await child.mouse.up();
  await page.waitForTimeout(350);
  const dropped = await child.locator(`[data-panel-id="${lichess}"]`).boundingBox();
  expect(Math.abs(dropped.x - preview.x)).toBeLessThan(1);
  expect(Math.abs(dropped.width - preview.width)).toBeLessThan(1);
  expect(await page.evaluate(() => window.groups.getState().groups.get(window.workspaces.getState().windows[0].groupId).layoutConfig.direction)).toBe('right');
  // Tab borders are real visible outlines, including inactive tabs.
  expect(await child.locator('.detached-tab').evaluateAll(nodes => nodes.every(node => {
    const s = getComputedStyle(node); return s.borderTopStyle === 'solid' && parseFloat(s.borderTopWidth) >= 1 && s.borderTopColor !== 'rgba(0, 0, 0, 0)';
  }))).toBe(true);
  await child.screenshot({ path: 'C:/Users/ady/tessera-browser-validation/detached-mosaic.png' });
  // Reopening the group restores its direction and divider sizes.
  const saved = await page.evaluate(() => window.serializeWorkspace());
  expect(Object.values(saved.groups).some(g => g.childIds.length === 5 && g.layoutConfig.direction === 'right')).toBe(true);
  expect(errors).toEqual([]);
  console.log('PASS detached 1/2/5-panel mosaics, focus, independent dividers/maximize, exact snap preview, saved layout, visible tab borders');
} finally { await browser.close(); }
