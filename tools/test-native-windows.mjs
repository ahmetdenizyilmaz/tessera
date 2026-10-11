// Run the isolated window_validation Rust example with CDP on 9231 first.
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9231');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('window-fixture'));
const errors = [];
let childBrowser;
let secondBrowser;
page.on('pageerror', e => errors.push(e.message));
page.on('console', message => { if (message.type() === 'error') console.log('native console:', message.text()); });
const drag = (from, to) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/drag-native-tab.ps1', '-StartX', String(Math.round(from.x)), '-StartY', String(Math.round(from.y)), '-EndX', String(Math.round(to.x)), '-EndY', String(Math.round(to.y)), ...(process.argv.includes('--fast') ? ['-Steps', '2', '-StepDelayMs', '10'] : [])]);
const point = async (p, label, selector) => {
  // Focus expands mosaic panels. Measure only after those CSS transitions end.
  await p.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const pos = await page.evaluate(label => window.__TAURI_INTERNALS__.invoke('plugin:window|inner_position', { label }), label);
  const rect = await p.locator(selector).boundingBox();
  const scale = await p.evaluate(() => devicePixelRatio);
  return { x: pos.x + (rect.x + Math.min(30, rect.width / 2)) * scale, y: pos.y + (rect.y + Math.min(14, rect.height / 2)) * scale };
};
try {
  await page.waitForFunction(() => !!window.workspaces);
  if (process.argv.includes('--reload')) {
    // Destroy the previous fixture's child windows before resetting its stores.
    for (const label of await page.evaluate(() => window.workspaces.getState().windows.map(w => window.windows.windowLabel(w.id)))) {
      await page.evaluate(label => window.__TAURI_INTERNALS__.invoke('workspace_window_destroy', { label }), label);
    }
    await page.evaluate(async () => { for (const [id, p] of window.plugins.getState().instances) if (p.pluginName === 'lichess') await window.__TAURI_INTERNALS__.invoke('browser_panel_close', { id }); });
    await page.reload();
  }
  await page.evaluate(() => {
    for (const workspace of window.workspaces.getState().windows) {
      for (const id of window.groups.getState().groups.get(workspace.groupId)?.childIds ?? []) window.windows.movePanelToWindow(id, null);
    }
  });
  await expect(page.locator('.tab-item')).toHaveCount(3);
  await page.evaluate(() => { window.pointerLog = []; for (const type of ['pointerdown','pointerup','pointercancel']) document.addEventListener(type, e => window.pointerLog.push({ type, x:e.clientX, y:e.clientY, target:e.target.className })); });
  await page.evaluate(() => {
    window.dropLog = [];
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      const result = await invoke(command, args, options);
      if (command === 'workspace_drop_target') window.dropLog.push(result);
      return result;
    };
  });
  await page.evaluate(maximized => { window.__testMaximized = maximized; }, process.argv.includes('--maximized'));
  await page.evaluate(async () => {
    const call = window.__TAURI_INTERNALS__.invoke;
    const wantsMaximized = !!window.__testMaximized;
    if ((await call('plugin:window|is_maximized', { label: 'main' })) !== wantsMaximized) await call('plugin:window|toggle_maximize', { label: 'main' });
    await call('plugin:window|set_focus', { label: 'main' });
  });
  const from = await point(page, 'main', process.argv.includes('--header') ? '.browser-title' : '.tab-item:has-text("Lichess")');
  const outside = process.argv.includes('--maximized') ? { x: from.x + 50, y: from.y + 240 } : await page.evaluate(() => ({ x: screen.availWidth * devicePixelRatio - 40, y: screen.availHeight * devicePixelRatio - 100 }));
  console.log('drag outside', from, outside);
  drag(from, outside);
  console.log('pointer log', await page.evaluate(() => window.pointerLog));
  await expect.poll(() => page.evaluate(() => window.workspaces.getState().windows.length), { timeout: 18000 }).toBe(1);
  const [w1] = await page.evaluate(() => window.workspaces.getState().windows);
  const label1 = `workspace-${w1.id}`;
  childBrowser = await chromium.connectOverCDP('http://127.0.0.1:9231');
  const child = childBrowser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(w1.id));
  await expect(child.locator('.detached-tab')).toHaveCount(1);
  await expect(child.locator('.browser-error')).toHaveCount(0);
  console.log('native detach passed');
  await page.evaluate(async () => {
    const call = window.__TAURI_INTERNALS__.invoke;
    if (await call('plugin:window|is_maximized', { label: 'main' })) await call('plugin:window|toggle_maximize', { label: 'main' });
  });
  // Move Main's timer to the detached window using physical mouse input.
  await page.evaluate(async () => window.__TAURI_INTERNALS__.invoke('workspace_window_place', {
    label: window.windows.windowLabel(window.workspaces.getState().windows[0].id),
    bounds: { x: 1900, y: 100, width: 850, height: 1000 },
  }));
  // Put both fixture windows above unrelated desktop apps before physical input.
  await page.evaluate(label => window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label }), label1);
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }));
  const timerFrom = await point(page, 'main', '.tab-item:last-child');
  const childTo = await point(child, label1, '.detached-tabs');
  console.log('drag into child', timerFrom, childTo);
  drag(timerFrom, childTo);
  try { await expect(child.locator('.detached-tab')).toHaveCount(2); }
  catch (error) { console.log('drop targets', await page.evaluate(() => window.dropLog)); throw error; }
  await expect(child.locator('.detached-tab').first()).toContainText('Timer');
  await expect(child.locator('.mosaic-tile')).toHaveCount(2);
  for (const tile of await child.locator('.mosaic-tile').all()) {
    await expect(tile).toBeVisible();
    const bounds = await tile.boundingBox();
    expect(bounds.width).toBeGreaterThan(80);
    expect(bounds.height).toBeGreaterThan(80);
  }
  const borders = await child.locator('.detached-tab').evaluateAll(tabs => tabs.map(tab => {
    const style = getComputedStyle(tab);
    return { width: style.borderTopWidth, color: style.borderTopColor, background: style.backgroundColor };
  }));
  for (const border of borders) { expect(border.width).toBe('1px'); expect(border.color).not.toBe(border.background); }
  console.log('native merge passed');
  await page.evaluate(label => window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label }), label1);
  await child.locator('.detached-tab:has-text("Lichess")').click();
  drag(await point(child, label1, process.argv.includes('--header') ? '.browser-title' : '.detached-tab:has-text("Lichess")'), { x: 60, y: 1100 });
  await expect.poll(() => page.evaluate(() => window.workspaces.getState().windows.length)).toBe(2);
  const w2 = await page.evaluate(() => window.workspaces.getState().windows[1]);
  secondBrowser = await chromium.connectOverCDP('http://127.0.0.1:9231');
  const second = secondBrowser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(w2.id));
  await expect(second.locator('.detached-tab')).toHaveCount(1);
  drag(await point(second, `workspace-${w2.id}`, '.detached-tab'), childTo);
  await expect(child.locator('.detached-tab')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.workspaces.getState().windows.length)).toBe(1);
  console.log('native child detach and window-to-window merge passed');
  // Return Lichess using the child toolbar, retaining its live native webview.
  await child.locator('.detached-tab').filter({ hasText: 'Lichess' }).click();
  const before = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_panel_status', { id: window.lichess }));
  await child.getByTitle('Move active panel back to main window').click();
  await expect(page.locator('.tab-item').filter({ hasText: 'Lichess' })).toBeVisible();
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_panel_status', { id: window.lichess }))).toEqual(before);
  // Native close request must reach Main's listener and close only child tabs.
  await page.evaluate(label => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label }), label1);
  await expect.poll(() => page.evaluate(() => window.workspaces.getState().windows.length)).toBe(0);
  expect(await page.evaluate(() => window.plugins.getState().instances.has(window.timer))).toBe(false);
  expect(await page.evaluate(() => window.plugins.getState().instances.has(window.lichess))).toBe(true);
  await page.waitForTimeout(750);
  await expect(page.locator('.tab-item').filter({ hasText: 'Lichess' })).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS native outside drag, native merge, live Lichess reparent, native close cleanup');
} finally { await secondBrowser?.close(); await childBrowser?.close(); await browser.close(); }
