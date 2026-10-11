// Exact rendered preview/drop geometry with the real components, including
// browser/iframe surfaces and pointer capture. Run with Vite on port 1420.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); });
const rectangles = selector => page.locator(selector).evaluateAll(nodes => nodes.map(node => {
  const r = node.getBoundingClientRect();
  return { id: node.dataset.previewPanelId ?? node.dataset.panelId, x: r.x, y: r.y, w: r.width, h: r.height };
}).sort((a, b) => a.id.localeCompare(b.id)));
try {
  await page.goto('http://127.0.0.1:1420/tools/window-fixture.html');
  await page.waitForFunction(() => !!window.layout);
  const counts = [1, 2, 3, 4, 5, 8, 12];
  for (const count of counts) {
    await page.evaluate(count => {
      window.layout.setState(window.layout.getInitialState(), true);
      window.groups.setState(window.groups.getInitialState(), true);
      window.plugins.setState({ instances: new Map() });
      for (let i = 0; i < count; i++) {
        const id = `fixture-${count}-${i}`;
        window.plugins.getState().restoreInstance(i === 0 ? 'lichess' : 'timer', id);
        window.layout.getState().addPanel(id, 'plugin');
      }
      window.layout.getState().setFocused(window.layout.getState().tabOrder[0]);
    }, count);
    await expect(page.locator('.mosaic-tile')).toHaveCount(count);
    await page.waitForTimeout(350);
    for (const [name, x, y] of [['left', .1, .5], ['right', .9, .5], ['top', .5, .1], ['bottom', .5, .9], ['corner', .9, .9], ['center', .5, .5]]) {
      const id = await page.evaluate(() => window.layout.getState().tabOrder[0]);
      const header = page.locator(`[data-panel-id="${id}"] .terminal-toolbar`).first();
      const h = await header.boundingBox();
      const c = await page.locator('.mosaic-container').boundingBox();
      const before = await rectangles('.mosaic-tile');
      await page.mouse.move(h.x + 60, h.y + 14); await page.mouse.down();
      await page.mouse.move(c.x + c.width * x, c.y + c.height * y, { steps: 8 });
      await expect(page.locator('[data-preview-panel-id]')).toHaveCount(count);
      expect(await rectangles('.mosaic-tile')).toEqual(before);
      const preview = await rectangles('[data-preview-panel-id]');
      if (count === 3 && name === 'right') await page.screenshot({ path: 'C:/Users/ady/tessera-browser-validation/drag-preview-three.png' });
      if (count === 12 && name === 'right') await page.screenshot({ path: 'C:/Users/ady/tessera-browser-validation/drag-preview-twelve.png' });
      await page.mouse.up();
      await expect(page.locator('[data-preview-panel-id]')).toHaveCount(0);
      await page.waitForTimeout(350);
      const after = await rectangles('.mosaic-tile');
      expect(after.map(r => r.id)).toEqual(preview.map(r => r.id));
      for (let i = 0; i < after.length; i++) for (const key of ['x', 'y', 'w', 'h']) expect(Math.abs(after[i][key] - preview[i][key]), `${count} ${name} ${i} ${key}`).toBeLessThan(.2);
    }
  }
  // Cancellation must restore input and leave the panel arrangement alone.
  const before = await rectangles('.mosaic-tile');
  const h = await page.locator('.mosaic-tile .terminal-toolbar').first().boundingBox();
  await page.mouse.move(h.x + 60, h.y + 14); await page.mouse.down(); await page.mouse.move(400, 400, { steps: 6 });
  await expect(page.locator('[data-preview-panel-id]')).toHaveCount(12);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('[data-preview-panel-id]')).toHaveCount(0);
  expect(await rectangles('.mosaic-tile')).toEqual(before);
  expect(await page.locator('html').getAttribute('data-tab-dragging')).toBeNull();
  expect(errors).toEqual([]);
  console.log('PASS 42 real drags: exact preview/drop pixel geometry, 1–12 actual slots, stationary content, iframe capture, Escape cleanup');
} finally { await browser.close(); }
