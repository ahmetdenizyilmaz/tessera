// npm run dev, then node tools/test-lan-connect.mjs [http://127.0.0.1:1420]
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
let page;
const open = async scenario => {
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', error => { if (!error.message.includes('WebSocket closed without opened')) errors.push(error.message); });
  await page.route('**/lan-connect-test*', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/lan-connect-fixture.jsx"></script>` }));
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/lan-connect-test?scenario=${scenario}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'Local PC', exact: false }).click({ timeout: 60000 });
};
const submit = async () => {
  await page.getByPlaceholder('192.168.1.20').fill('192.168.88.62');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Waiting…', exact: true })).toBeDisabled();
};
const expectGroup = async () => {
  await expect(page.locator('.nsw')).toHaveCount(0);
  const id = await page.evaluate(() => [...window.groups.getState().groups.values()].find(group => group.remotePeerId === 'other-pc')?.id);
  expect(id).toBeTruthy();
  const tile = page.locator(`[data-panel-id="${id}"]`);
  await expect(tile).toBeVisible();
  expect(await page.evaluate(() => window.groups.getState().groupStack)).toEqual([]);
  expect(await page.evaluate(() => window.layout.getState().focusedId)).toBe(id);
  expect(await page.evaluate(() => window.layout.getState().activeTabId)).toBe(id);
  await expect.poll(async () => (await tile.boundingBox()).width).toBeGreaterThan(700);
  await expect(tile).toContainText('Shared chat');
  await tile.getByTitle('Enter group').click();
  await expect(page.getByText('Remote connection fixture', { exact: true })).toBeVisible();
};
try {
  await open('nested-hidden');
  await submit();
  await page.evaluate(() => window.completeConnection('success'));
  await expectGroup();
  expect(await page.evaluate(() => window.lan.getState().hiddenPeerIds)).toEqual([]);
  console.log('PASS connecting from nested groups restores the hidden PC, focuses it, and opens remote panels');

  await open('root');
  await submit();
  await page.evaluate(() => window.completeConnection('success'));
  await expectGroup();
  console.log('PASS root-level connection focuses the remote group instead of another local panel');

  await open('root');
  await expect(page.getByRole('button', { name: 'View offline', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.evaluate(() => window.completeConnection('offline'));
  await expect(page.getByRole('alert')).toContainText('not connected');
  await expect(page.locator('.nsw')).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.evaluate(() => window.completeConnection('success'));
  await expectGroup();
  console.log('PASS offline cached PC offers Reconnect, keeps errors visible, and reveals a successful retry');

  await open('root');
  await submit();
  await page.evaluate(() => window.completeConnection('offline'));
  await expect(page.getByRole('alert')).toContainText('not connected');
  await expect(page.locator('.nsw')).toBeVisible();
  await submit();
  await page.evaluate(() => window.completeConnection('error'));
  await expect(page.getByRole('alert')).toContainText('Could not reach');
  await expect(page.locator('.nsw')).toBeVisible();
  console.log('PASS unsuccessful connections leave the wizard open with an actionable error');
  expect(errors).toEqual([]);
} finally { await browser.close(); }
