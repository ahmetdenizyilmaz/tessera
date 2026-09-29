// npm run dev, then node tools/test-group-panels.mjs [http://127.0.0.1:1420]
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.setDefaultTimeout(15000);
page.on('pageerror', error => { if (!error.message.includes('WebSocket closed without opened')) errors.push(error.message); });
await page.route('**/group-panels-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/group-panels-fixture.jsx"></script>` }));
const dialog = page.getByRole('dialog');
const tile = id => page.locator(`[data-panel-id="${id}"]`);
const enter = async id => {
  await tile(id).getByTitle('Enter group').click();
  await expect(tile(id)).toHaveCount(0);
};
const goMain = async () => {
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await page.waitForFunction(() => window.groups.getState().transitionDirection === null);
};
try {
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/group-panels-test`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(tile('chat').getByLabel('Message Codex')).toBeEnabled({ timeout: 60000 });
  if (process.env.TESSERA_GROUP_SCREENSHOTS) await page.screenshot({ path: `${process.env.TESSERA_GROUP_SCREENSHOTS}/group-controls.png` });
  const [work, research] = await page.evaluate(() => [...window.groups.getState().groups.keys()]);
  await tile('chat').getByLabel('Message Codex').fill('Keep this draft while moving');
  await tile('chat').getByRole('button', { name: 'Move to group', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Search groups')).toBeFocused();
  await dialog.getByLabel('Search groups').fill('wor');
  await expect(dialog.getByRole('button', { name: 'Research Main', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Work Main', exact: true }).click();
  await expect(tile('chat')).toHaveCount(0);
  await enter(work);
  await expect(tile('chat').getByLabel('Message Codex')).toHaveValue('Keep this draft while moving');
  console.log('PASS panel header picker, search, move, and draft preservation');

  // Pull a root panel into an already-open group, then move it into a sibling.
  await page.getByRole('button', { name: 'Add existing panel', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Build terminal Main', exact: true }).check();
  await dialog.getByRole('button', { name: 'Add 1 panel', exact: true }).click();
  await expect(tile('terminal')).toBeVisible();
  await tile('terminal').getByRole('button', { name: 'Move to group', exact: true }).click();
  await dialog.getByRole('button', { name: 'Research Main', exact: true }).click();
  await expect(tile('terminal')).toHaveCount(0);
  await goMain();
  await enter(research);
  await expect(tile('terminal')).toBeVisible();
  await tile('terminal').getByRole('button', { name: 'Move to group', exact: true }).click();
  await dialog.getByRole('button', { name: 'Main Top-level workspace', exact: true }).click();
  await goMain();
  await expect(tile('terminal')).toBeVisible();
  console.log('PASS add from inside a group, sibling moves, and return to Main');

  // Group preview can collect panels from Main and another closed group at once.
  await tile(research).getByRole('button', { name: 'Add existing panel', exact: true }).first().click();
  await dialog.getByRole('checkbox', { name: 'Build terminal Main', exact: true }).check();
  await dialog.getByLabel('Search panels').fill('Planning');
  await dialog.getByRole('checkbox', { name: 'Planning chat Main / Work', exact: true }).check();
  if (process.env.TESSERA_GROUP_SCREENSHOTS) await page.screenshot({ path: `${process.env.TESSERA_GROUP_SCREENSHOTS}/add-existing-panels.png` });
  await dialog.getByRole('button', { name: 'Add 2 panels', exact: true }).click();
  await enter(research);
  await expect(tile('chat').getByLabel('Message Codex')).toHaveValue('Keep this draft while moving');
  await expect(tile('terminal')).toBeVisible();
  const killed = await page.evaluate(() => window.calls.filter(call => /pty_kill|stream_kill|codex_destroy|codex_close|llm_destroy_session/.test(call.command)));
  expect(killed).toEqual([]);
  const restored = await page.evaluate(() => window.roundTrip());
  await enter(research);
  await expect(tile(restored['Planning chat'])).toBeVisible();
  await expect(tile(restored['Build terminal'])).toBeVisible();
  console.log('PASS group preview multiselect and workspace save/restore');

  // A narrow panel still exposes the new control; Escape cancels without moving.
  await page.setViewportSize({ width: 700, height: 600 });
  await tile(restored['Planning chat']).getByRole('button', { name: 'Move to group', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tile(restored['Planning chat'])).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS narrow layout, cancel, and no session shutdown during moves');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error((await page.locator('body').innerText()).slice(0, 1800));
  throw error;
} finally {
  await browser.close();
}
