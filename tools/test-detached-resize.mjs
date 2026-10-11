// Check panel CONTENT sizes as well as their percentage-sized outer frames.
// Run Vite first. With --native, use the isolated window_validation example on 9231.
import { chromium, expect } from '@playwright/test';

const native = process.argv.includes('--native');
const browser = native ? await chromium.connectOverCDP('http://127.0.0.1:9231')
  : await chromium.launch({ channel: 'msedge', headless: true });
const connections = [];
const main = native ? browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('window-fixture'))
  : await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
main.on('pageerror', e => errors.push(e.message));
let child;
const mismatch = page => page.locator('.mosaic-tile').evaluateAll(tiles => tiles.map(tile => {
  const content = tile.firstElementChild.getBoundingClientRect();
  return { id: tile.dataset.panelId, frame: [tile.clientWidth, tile.clientHeight], content: [content.width, content.height],
    error: Math.max(Math.abs(content.width - tile.clientWidth), Math.abs(content.height - tile.clientHeight)) };
}));
const check = async () => {
  await expect.poll(async () => (await mismatch(child)).every(tile => tile.error < 1.5), { message: 'Every panel body must fill its resized frame', timeout: 5000 }).toBe(true);
};
try {
  if (!native) await main.goto('http://127.0.0.1:1420/tools/window-fixture.html');
  await main.waitForFunction(() => !!window.windows);
  if (native) await main.reload();
  await main.waitForFunction(() => !!window.windows);
  const popup = !native && main.waitForEvent('popup');
  await main.evaluate(() => window.windows.detachPanel(window.lichess));
  const workspace = await main.evaluate(() => window.workspaces.getState().windows[0]);
  if (native) {
    const connection = await chromium.connectOverCDP('http://127.0.0.1:9231'); connections.push(connection);
    child = connection.contexts().flatMap(c => c.pages()).find(p => p.url().includes(workspace.id));
  } else child = await popup;
  child.on('pageerror', e => errors.push(e.message));
  await expect(child.locator('.mosaic-tile')).toHaveCount(1);
  // Add through the real detached-window menu, as in the user's sequence.
  await child.getByTitle('Add a panel', { exact: true }).click();
  await child.locator('.detached-new .menu-dropdown').getByRole('button', { name: 'New session', exact: true }).click();
  await expect(child.locator('.mosaic-tile')).toHaveCount(2);
  await child.getByTitle('Add a panel', { exact: true }).click();
  await child.locator('.detached-new .menu-dropdown').getByRole('button', { name: 'Timer', exact: true }).click();
  await expect(child.locator('.mosaic-tile')).toHaveCount(3);
  await check();
  for (const [width, height] of [[750, 520], [1300, 850], [920, 620]]) {
    if (native) await main.evaluate(({ id, width, height }) => window.__TAURI_INTERNALS__.invoke('workspace_window_place', {
      label: `workspace-${id}`, bounds: { x: 100, y: 80, width: Math.round(width * devicePixelRatio), height: Math.round(height * devicePixelRatio) },
    }), { id: workspace.id, width, height });
    else await child.setViewportSize({ width, height });
    await expect.poll(() => child.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
    await check();
    console.log(`PASS panel content fills frames after detached resize to ${width}x${height}`);
  }
  if (native) {
    for (let i = 0; i < 2; i++) {
      const previousWidth = await child.evaluate(() => innerWidth);
      await main.evaluate(id => window.__TAURI_INTERNALS__.invoke('plugin:window|toggle_maximize', { label: `workspace-${id}` }), workspace.id);
      await expect.poll(() => child.evaluate(() => innerWidth)).not.toBe(previousWidth);
      await check();
    }
    console.log('PASS native maximize/restore after adding New session');
  }
  expect(errors).toEqual([]);
} catch (error) {
  if (child && !child.isClosed()) console.log('panel dimensions', await mismatch(child));
  throw error;
} finally {
  // Always close fixture windows so there are no unresponsive test leftovers.
  if (native && main && !main.isClosed()) {
    await main.evaluate(async () => {
      for (const w of [...window.workspaces.getState().windows]) await window.windows.closeDetachedWorkspace(w.id);
      await window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' });
    }).catch(() => {});
  }
  for (const connection of connections) await connection.close();
  await browser.close();
}
