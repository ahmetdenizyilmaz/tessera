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

  for (const count of [6, 8]) for (const direction of ['left', 'top', 'right', 'bottom']) {
    await page.reload();
    await page.waitForFunction(() => !!window.showMosaic);
    const order = await page.evaluate(async ({ count, direction }) => {
      window.showMosaic(count);
      const { useLayoutStore } = await import('/src/store/layoutStore.ts');
      useLayoutStore.setState({ sidebarSlotFractions: [10, 20, 30, 40] });
      useLayoutStore.getState().applySnap('codex-ui', direction);
      return useLayoutStore.getState().layoutConfig.panelOrder;
    }, { count, direction });
    await page.waitForTimeout(350);
    const boxes = await page.locator('.mosaic-tile').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
      const r = node.getBoundingClientRect();
      return [node.dataset.panelId, { x: r.x, y: r.y, w: r.width, h: r.height }];
    })));
    const points = order.map(id => ({ x: boxes[id].x + boxes[id].w / 2, y: boxes[id].y + boxes[id].h / 2 }));
    expect(points.reduce((area, p, i) => {
      const q = points[(i + 1) % points.length];
      return area + p.x * q.y - q.x * p.y;
    }, 0)).toBeGreaterThan(0);
    await page.locator(`[data-panel-id="${order.at(-1)}"] .terminal-toolbar`).click({ position: { x: 3, y: 5 } });
    // Check the actual rendered destinations after a header click, including
    // movement across the sidebar/overflow boundary, not only store values.
    for (let i = 0; i < order.length; i++) {
      const target = boxes[order[(i + 1) % order.length]];
      await expect.poll(async () => {
        const r = await page.locator(`[data-panel-id="${order[i]}"]`).boundingBox();
        return Math.max(Math.abs(r.x - target.x), Math.abs(r.y - target.y), Math.abs(r.width - target.w), Math.abs(r.height - target.h));
      }).toBeLessThan(1);
    }
  }
  console.log('PASS real header clicks rotate 6/8 panels clockwise in all four orientations, with resized slots');
} finally {
  await browser.close();
}
