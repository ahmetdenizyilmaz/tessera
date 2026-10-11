import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1.5 });
const errors = [];
page.context().on('page', p => p.on('pageerror', e => errors.push(e.message)));
page.on('pageerror', e => errors.push(e.message));
const rects = p => p.locator('.mosaic-tile').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.panelId,
  left: node.style.left, top: node.style.top, width: node.style.width, height: node.style.height })));
async function dragDivider(p) {
  const gutter = await p.locator('.mosaic-gutter-x').first().boundingBox();
  await p.mouse.move(gutter.x + 4, gutter.y + 30); await p.mouse.down();
  await p.mouse.move(gutter.x - 100, gutter.y + 30, { steps: 12 }); await p.mouse.up();
}
const count = () => page.evaluate(() => window.edits.getState().past.length);
try {
  await page.goto('http://127.0.0.1:1420/tools/window-fixture.html');
  await page.waitForFunction(() => !!window.windows);
  await page.addStyleTag({ content: readFileSync('src/styles/themes.css', 'utf8') });
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = 'dark';
    window.edits = (await import('/src/store/workspaceHistoryStore.ts')).useWorkspaceHistoryStore;
    window.recents = (await import('/src/store/recentPanelStore.ts')).useRecentPanelStore;
    window.panelHistory = await import('/src/lib/panelHistory.ts');
    window.panelHistory.installRecentPanelTracking();
    (await import('/src/lib/workspaceHistoryShortcuts.ts')).installWorkspaceHistoryShortcuts(window);
  });
  await expect.poll(() => page.evaluate(() => window.recents.getState().entries.length)).toBe(3);
  const before = await rects(page);
  await dragDivider(page);
  await expect.poll(count).toBe(1);
  const after = await rects(page);
  expect(after).not.toEqual(before);
  await page.keyboard.press('Control+z');
  await expect.poll(() => rects(page)).toEqual(before);
  await page.keyboard.press('Control+y');
  await expect.poll(() => rects(page)).toEqual(after);
  expect(await count()).toBe(1);
  // Starting and cancelling another drag never adds history.
  const gutter = await page.locator('.mosaic-gutter-x').first().boundingBox();
  await page.mouse.move(gutter.x + 4, gutter.y + 30); await page.mouse.down();
  await page.mouse.move(gutter.x - 50, gutter.y + 30, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await count()).toBe(1);
  await expect.poll(() => rects(page)).toEqual(after);
  console.log('PASS keyboard resize undo/redo, one step per drag, cancelled drag');

  const timer = await page.evaluate(() => window.timer);
  await page.locator(`[data-tab-id="${timer}"] .tab-close-btn`).click();
  await expect(page.locator('.mosaic-tile')).toHaveCount(2);
  await expect.poll(count).toBe(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.mosaic-tile')).toHaveCount(3);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.mosaic-tile')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.mosaic-tile')).toHaveCount(3);
  // Genuine editor keystrokes keep native undo/redo, even after panel controls.
  await page.evaluate(() => {
    const input = document.createElement('textarea'); input.id = 'typing-test';
    input.style.cssText = 'position:fixed;top:60px;left:30px;z-index:99999'; document.body.append(input);
  });
  await page.locator('#typing-test').click();
  await page.keyboard.type('Draft text');
  const past = await count();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#typing-test')).toHaveValue('');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#typing-test')).toHaveValue('Draft text');
  expect(await count()).toBe(past);
  await page.locator('#typing-test').evaluate(node => node.remove());
  console.log('PASS close/reopen/reclose shortcuts, preserved text editing');

  await page.evaluate(() => window.creation.openNewSessionWizard());
  await page.getByRole('button', { name: /Recent panels/ }).click();
  await expect(page.locator('.nsw-recent-panel')).toHaveCount(0);
  await expect(page.locator('.nsw-recents-count')).toHaveCount(0);
  await expect(page.locator('.nsw-recents-empty')).toContainText('Recently closed panels');
  expect(await page.evaluate(() => window.plugins.getState().instances.size)).toBe(2);
  // Closing via the panel header must use the same history path as the tab X.
  await page.locator(`[data-panel-id="${timer}"] .terminal-toolbar button`).last().click();
  await expect(page.locator(`[data-tab-id="${timer}"]`)).toHaveCount(0);
  await expect(page.locator('.nsw-recents-count')).toHaveText('1');
  await page.getByRole('textbox', { name: 'Search recent panels' }).fill('Timer');
  await expect(page.locator('.nsw-recent-panel')).toHaveCount(1);
  await expect(page.locator('.nsw-recent-panel')).toContainText('Reopen');
  await page.locator('.nsw-recent-panel').click();
  await expect(page.locator(`[data-tab-id="${timer}"]`)).toHaveCount(1);
  await expect(page.locator('.nsw')).toHaveCount(0);
  console.log('PASS open panels hidden from recents, live close update, search and reopen');

  const popup = page.waitForEvent('popup');
  await page.evaluate(() => window.windows.detachPanel(window.lichess));
  let child = await popup;
  await page.evaluate(() => window.windows.movePanelToWindow(window.timer, window.workspaces.getState().windows[0]));
  await expect(child.locator('.mosaic-tile')).toHaveCount(2);
  await child.locator('.detached-tab').first().click();
  const mainRects = await rects(page); const childBefore = await rects(child);
  await dragDivider(child);
  const childAfter = await rects(child); expect(childAfter).not.toEqual(childBefore);
  await child.keyboard.press('Control+z'); await expect.poll(() => rects(child)).toEqual(childBefore);
  await child.keyboard.press('Control+y'); await expect.poll(() => rects(child)).toEqual(childAfter);
  expect(await rects(page)).toEqual(mainRects);
  await child.getByRole('button', { name: 'Close Timer', exact: true }).click();
  await expect(child.locator('.mosaic-tile')).toHaveCount(1);
  await child.keyboard.press('Control+z');
  await expect(child.locator('.mosaic-tile')).toHaveCount(2);
  console.log('PASS detached keyboard resize/close history and unchanged Main');

  const closed = child.waitForEvent('close');
  await child.keyboard.press('Control+Shift+w').catch(error => { if (!child.isClosed()) throw error; }); await closed;
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => window.workspaces.getState().windows.length)).toBe(0);
  const recovered = page.waitForEvent('popup');
  await page.locator('.tab-item').first().click();
  await page.keyboard.press('Control+z'); child = await recovered;
  await expect(child.locator('.mosaic-tile')).toHaveCount(2);
  console.log('PASS undo restores closed detached window and both panels');

  await page.evaluate(() => window.windows.movePanelToWindow(window.timer, null));
  await expect(child.locator('.mosaic-tile')).toHaveCount(1);
  const lastClosed = child.waitForEvent('close');
  await child.getByRole('button', { name: 'Close Lichess', exact: true }).click(); await lastClosed;
  const recoveredLast = page.waitForEvent('popup');
  await page.keyboard.press('Control+z'); child = await recoveredLast;
  await expect(child.locator('.mosaic-tile')).toHaveCount(1);
  await expect(child.locator('.detached-tab')).toContainText('Lichess');
  console.log('PASS last detached tab can be closed and reopened without orphan windows');

  await page.evaluate(() => window.creation.openNewSessionWizard());
  await page.getByRole('button', { name: /Recent panels/ }).click();
  await expect(page.locator('.nsw-recent-panel')).toHaveCount(0);
  await expect(page.locator('.nsw-recents-count')).toHaveCount(0);
  await page.locator('.nsw').screenshot({ path: 'C:/Users/ady/tessera-browser-validation/recent-panels-dark.png' });
  await page.locator('.tab-bar').screenshot({ path: 'C:/Users/ady/tessera-browser-validation/tab-highlight-dark.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.locator('.nsw').screenshot({ path: 'C:/Users/ady/tessera-browser-validation/recent-panels-light.png' });
  expect(await page.locator('.tab-item').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).borderTopWidth === '1px'))).toBe(true);
  expect(errors).toEqual([]);
  console.log('PASS visible outlines, dark/light previews, no browser errors');
} finally { await browser.close(); }
