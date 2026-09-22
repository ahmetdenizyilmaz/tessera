// npm run dev, then node tools/test-stacked-divider.mjs [http://127.0.0.1:1420]
// Real mosaic, pointer drags and xterm; isolated mock PTYs, no user sessions.
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.route('**/stacked-divider-test', route => route.fulfill({
  contentType: 'text/html',
  body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/panel-ui-fixture.jsx"></script>`,
}));
const dividerX = async () => {
  const box = await page.locator('.mosaic-gutter-x').boundingBox();
  return box.x + box.width / 2;
};
const switchTo = async id => {
  await page.locator(`[data-panel-id="${id}"]`).getByTitle('Double-click to rename').click();
  await page.waitForTimeout(350);
};
try {
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/stacked-divider-test`);
  await page.waitForFunction(() => !!window.showMosaic);
  await page.evaluate(() => window.showMosaic(5));
  await page.locator('.mosaic-gutter-x').waitFor();
  await page.waitForTimeout(500);
  const original = await dividerX();
  await page.mouse.move(original, 400);
  await page.mouse.down();
  await page.mouse.move(750, 400, { steps: 15 });
  await page.mouse.up();
  await expect.poll(dividerX).toBeCloseTo(750, 0);
  for (const id of ['peer-ui', 'peer-2', 'peer-3', 'peer-4', 'codex-ui']) {
    await switchTo(id);
    await expect.poll(dividerX).toBeCloseTo(750, 0);
  }
  console.log('PASS real divider drag stays at 50/50 through all five panel focus changes');

  // Persist a real workspace snapshot and restore it in a fresh page load.
  await page.evaluate(async () => {
    const { serializeWorkspace } = await import('/src/lib/workspaceSerializer.ts');
    localStorage.setItem('divider-test-workspace', JSON.stringify(serializeWorkspace()));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.showMosaic);
  const restoredIds = await page.evaluate(async () => {
    window.mosaicMode = true;
    const { deserializeWorkspace } = await import('/src/lib/workspaceSerializer.ts');
    const { useLayoutStore } = await import('/src/store/layoutStore.ts');
    deserializeWorkspace(JSON.parse(localStorage.getItem('divider-test-workspace')));
    window.showEmptyMosaic();
    return useLayoutStore.getState().tabOrder;
  });
  expect(restoredIds).toHaveLength(5);
  await page.locator('.mosaic-gutter-x').waitFor();
  await expect.poll(dividerX).toBeCloseTo(750, 0);
  for (const id of restoredIds.slice(0, 2)) {
    await switchTo(id);
    await expect.poll(dividerX).toBeCloseTo(750, 0);
  }
  console.log('PASS workspace reload preserves the divider, including after restored panel focus changes');
  await page.locator('.mosaic-gutter-x').dblclick();
  await expect.poll(dividerX).toBeCloseTo(original, 0);
  console.log('PASS double-click still restores the default 80/20 split');
} finally {
  await browser.close();
}
