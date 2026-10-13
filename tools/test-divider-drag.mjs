import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); });
const settle = () => page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'));
const mainDivider = () => page.locator('.mosaic-gutter-x').filter({ visible: true });
async function dragMain(delta, end = 'up') {
  const index = await mainDivider().evaluateAll(elements => elements.reduce((best, el, i) =>
    el.getBoundingClientRect().height > elements[best].getBoundingClientRect().height ? i : best, 0));
  const rect = await mainDivider().nth(index).boundingBox();
  const workspace = await page.locator('.mosaic-container').boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + workspace.width * delta / 100, y, { steps: 20 });
  if (end === 'escape') await page.keyboard.press('Escape');
  if (end === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  if (end === 'lost') {
    expect(await page.locator('.mosaic-container').evaluate(el => el.hasPointerCapture(1))).toBe(true);
    await page.locator('.mosaic-container').evaluate(el => el.releasePointerCapture(1));
    await page.mouse.move(x + workspace.width * delta / 100 + 1, y);
  }
  await page.mouse.up(); await settle();
  await expect(page.locator('.mosaic-gutter-dragging')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.cursor)).toBe('');
}
try {
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:1420'}/tools/window-fixture.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.tab-item')).toHaveCount(3);
  await page.evaluate(() => {
    for (let i = 0; i < 9; i++) window.creation.createPluginPanel('notepad');
    window.layout.getState().setFocused(window.lichess);
  });
  await expect(page.locator('.mosaic-tile')).toHaveCount(12); await settle();
  await dragMain(-30);
  const width = await page.evaluate(() => window.layout.getState().panelRects.get(window.lichess).w);
  console.log('Main divider after dragging from 80% to 50%:', width);
  expect(width).toBeCloseTo(50, 0);
  await dragMain(20);
  expect(await page.evaluate(() => window.layout.getState().panelRects.get(window.lichess).w)).toBeCloseTo(70, 0);
  for (const reason of ['escape', 'blur', 'lost']) {
    const before = await page.evaluate(() => [...window.layout.getState().panelRects]);
    await dragMain(-15, reason);
    expect(await page.evaluate(() => [...window.layout.getState().panelRects])).toEqual(before);
    await dragMain(-5); await dragMain(5);
  }
  // Align two independent dividers while dragging, then cross that position.
  await page.evaluate(() => {
    const ids = window.layout.getState().tabOrder.slice(0, 4);
    window.layout.getState().restoreLayout(ids, ids[0], ids[0], { type: 'quarters', panelOrder: ids }, new Map([
      [ids[0], { x: 0, y: 0, w: 60, h: 50 }], [ids[1], { x: 60, y: 0, w: 40, h: 50 }],
      [ids[2], { x: 0, y: 50, w: 50, h: 50 }], [ids[3], { x: 50, y: 50, w: 50, h: 50 }],
    ]), { x: .5, y: .5 }, window.layout.getState().panelTypes);
  });
  await settle();
  const top = await page.locator('.mosaic-gutter-x').evaluateAll(elements => elements.reduce((best, el, i) =>
    el.getBoundingClientRect().y < elements[best].getBoundingClientRect().y ? i : best, 0));
  const rect = await page.locator('.mosaic-gutter-x').nth(top).boundingBox();
  const ws = await page.locator('.mosaic-container').boundingBox();
  const startX = rect.x + rect.width / 2, startY = rect.y + rect.height / 2;
  await page.mouse.move(startX, startY); await page.mouse.down();
  await page.mouse.move(ws.x + ws.width * .5, startY);
  await page.mouse.move(ws.x + ws.width * .4, startY, { steps: 10 });
  await page.mouse.up(); await settle();
  const rects = await page.evaluate(() => window.layout.getState().tabOrder.map(id => window.layout.getState().panelRects.get(id)));
  expect(rects[0].w).toBeCloseTo(40, 0); expect(rects[2].w).toBe(50);
  await expect(page.locator('.mosaic-gutter-dragging')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('PASS twelve-panel resizing, Escape, window blur, lost capture, subsequent gestures, and crossing aligned dividers');
} finally { await browser.close(); }
