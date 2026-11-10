// Real React/SVG UI with synthetic records and mocked IPC; no live chats.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => { if (!error.message.includes('WebSocket closed')) errors.push(error.message); });
await page.route('**/activity-bubbles-test*', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/activity-fixture.jsx"></script>` }));
const active = () => page.locator('[data-active-record]').getAttribute('data-active-record');
const camera = () => page.locator('[data-bubble-camera]').getAttribute('transform');
const settings = () => page.getByRole('dialog', { name: 'Replay settings', exact: true });
const seek = index => page.getByRole('slider', { name: 'Replay position' }).fill(String(index));
try {
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:1420'}/activity-bubbles-test`);
  await expect(page.locator('[data-activity-node]')).toHaveCount(5);
  expect(await page.evaluate(() => window.activityCalls.find(c => c.command === 'activity_list').args.limit)).toBe(500);
  await page.getByRole('button', { name: 'Bubbles', exact: true }).click();
  await expect(page.locator('[data-activity-bubble]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Test engineer → Backend architect: 1 messages', exact: true })).toHaveCount(1);
  await expect(page.locator('[data-activity-bubble="claude:claude-backend"]')).toContainText('140.0k');
  await page.screenshot({ path: '.tmp/activity-bubbles/overview.png' });

  await page.getByRole('button', { name: 'Replay settings', exact: true }).click();
  await expect(settings()).toBeVisible();
  await settings().getByRole('combobox', { name: 'Playback pace' }).selectOption('events');
  await settings().getByRole('spinbutton', { name: 'Replay rate' }).fill('2');
  await settings().getByRole('combobox', { name: 'Connection trail' }).selectOption('60000');
  await page.getByRole('button', { name: 'Close replay settings' }).click();
  await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
  await page.getByRole('button', { name: 'Restart replay' }).click();
  await expect.poll(active).toBe('question');
  const startCamera = await camera();
  await page.getByRole('button', { name: 'Play replay' }).click();
  await expect.poll(active).toBe('testing');
  await page.getByRole('button', { name: 'Pause replay' }).click();
  const paused = await active();
  await page.waitForTimeout(700);
  expect(await active()).toBe(paused);
  expect(await camera()).not.toBe(startCamera);
  await seek(2);
  await expect.poll(active).toBe('handoff:a');
  await expect(page.locator('[data-active-record]')).toContainText('Test engineer');
  await expect(page.locator('[data-active-record]')).toContainText('Backend architect');
  await page.getByRole('button', { name: 'Next activity' }).click();
  await expect.poll(active).toBe('review-reply');
  await page.getByRole('button', { name: 'Previous activity' }).click();
  await expect.poll(active).toBe('handoff:a');
  await page.screenshot({ path: '.tmp/activity-bubbles/replay.png' });
  console.log('PASS named bubbles, directed handoffs, provider totals, play/pause, scrubbing, stepping and smooth focus');

  // A poll updating an old running turn must move Live Follow to that chat.
  await page.getByRole('button', { name: 'Live Follow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Focus mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const record = window.activityRecords.find(r => r.id === 'testing');
    record.updatedAt = Date.now(); record.status = 'running'; record.response = 'Still working on tests';
  });
  await expect.poll(active).toBe('testing');
  await expect(page.locator('.activity-bubble-canvas')).toHaveAttribute('data-following', 'codex:codex-tests');
  await page.evaluate(() => {
    const base = window.activityRecords[0];
    window.activityRecords.push({ ...base, id: 'fresh-handoff', kind: 'handoff', target: window.activityRecords[1].actor,
      prompt: 'Check the final build.', usage: null, startedAt: Date.now(), updatedAt: Date.now() });
  });
  await expect.poll(active).toBe('fresh-handoff');
  await expect(page.locator('[data-active-record]')).toContainText('Check the final build.');
  await page.waitForTimeout(750);
  const stableCamera = await camera();
  await page.evaluate(() => { window.activityRecords.at(-1).response = 'Delivered'; window.activityRecords.at(-1).updatedAt = Date.now(); });
  await page.waitForTimeout(2800);
  expect(await camera()).toBe(stableCamera);
  console.log('PASS Live Follow tracks updates and new senders without camera jitter on ordinary polls');

  // Dragging the canvas stops camera following, while the live feed continues.
  const canvas = await page.locator('.activity-bubble-canvas').boundingBox();
  await page.mouse.move(canvas.x + 20, canvas.y + 100); await page.mouse.down();
  await page.mouse.move(canvas.x + 80, canvas.y + 130, { steps: 5 }); await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Focus mode', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Live Follow', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Fit bubbles' }).click();

  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('button', { name: 'Replay settings', exact: true }).click();
  await expect(settings()).toBeVisible();
  await settings().getByRole('checkbox', { name: 'Loop replay' }).check();
  await settings().getByRole('combobox', { name: 'Playback pace' }).selectOption('time');
  await settings().getByRole('combobox', { name: 'Replay time unit' }).selectOption('day');
  await settings().getByRole('spinbutton', { name: 'Replay rate' }).fill('1');
  await page.screenshot({ path: '.tmp/activity-bubbles/narrow-settings.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(settings()).toHaveCount(0);
  await page.getByRole('button', { name: 'Play replay' }).click();
  await page.waitForTimeout(1400);
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Bubbles', exact: true }).click();
  await page.getByRole('button', { name: 'Replay settings', exact: true }).click();
  await expect(settings().getByRole('checkbox', { name: 'Loop replay' })).toBeChecked();
  await expect(settings().getByRole('combobox', { name: 'Replay time unit' })).toHaveValue('day');
  await settings().getByRole('combobox', { name: 'Connection trail' }).selectOption('0');
  await page.getByRole('button', { name: 'Close replay settings' }).click();
  console.log('PASS manual camera control, narrow settings, loop, Escape and saved replay preferences');

  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => {
    const samples = window.activityRecords.slice(0, 3), start = Date.now() - 750 * 3_600_000;
    window.activityRecords = Array.from({ length: 750 }, (_, i) => ({ ...samples[i % samples.length], id: 'bulk-' + String(i).padStart(4, '0'),
      startedAt: start + i * 3_600_000, updatedAt: start + i * 3_600_000 }));
  });
  await page.getByRole('combobox', { name: 'Activity date range' }).selectOption('all');
  await expect(page.locator('.activity-footer')).toContainText('500 loaded records');
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await expect(page.locator('[data-activity-node]')).toHaveCount(500);
  await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await expect(page.locator('.activity-footer')).toContainText('750 loaded records');
  await expect(page.locator('[data-activity-node]')).toHaveCount(500);
  await page.getByRole('button', { name: 'Bubbles', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveAttribute('max', '749');
  await seek(0);
  await expect.poll(active).toBe('bulk-0000');
  await seek(499);
  await expect(page.locator('.activity-bubble-status')).toContainText('500 / 500 events');
  await seek(749);
  await expect.poll(active).toBe('bulk-0749');
  await expect(page.locator('.activity-bubble-status')).toContainText('500 / 500 events');
  await page.getByRole('combobox', { name: 'Filter provider' }).selectOption('codex');
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveAttribute('max', '499');
  await page.getByRole('button', { name: 'Play replay' }).click();
  await page.getByRole('textbox', { name: 'Search activity' }).fill('no-such-message');
  await expect(page.getByText('No matching activity')).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS 500-event pages and Flow graph, replay across 750 loaded records, filtered bounds and cleanup');
} catch (error) {
  await page.screenshot({ path: '.tmp/activity-bubbles/failure.png', fullPage: true });
  throw error;
} finally { await browser.close(); }
