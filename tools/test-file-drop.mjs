// npm run dev, then node tools/test-file-drop.mjs [http://127.0.0.1:1420]
// No real files, CLI input or user workspaces are touched.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const deviceScaleFactor of [1, 1.5]) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => { if (!error.message.includes('WebSocket closed')) errors.push(error.message); });
    await page.route('**/file-drop-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/file-drop-fixture.jsx"></script>` }));
    await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:1420'}/file-drop-test`);
    await page.waitForFunction(() => window.fileDropReady);
    await expect(page.locator('.xterm')).toHaveCount(3);
    const settle = () => page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'));
    const tile = id => page.locator(`.mosaic-tile[data-panel-id="${id}"]`);
    const geometry = () => page.locator('.mosaic-tile').evaluateAll(tiles => tiles.map(el => ({
      id: el.dataset.panelId, rect: el.getBoundingClientRect().toJSON(),
    })));
    const writes = () => page.evaluate(() => window.calls.filter(c => c.command === 'pty_write').map(c => c.args));
    const focus = () => page.evaluate(() => window.layout.getState().focusedId);
    const position = async id => {
      const r = await tile(id).boundingBox();
      return { x: (r.x + r.width / 2) * deviceScaleFactor, y: (r.y + r.height / 2) * deviceScaleFactor };
    };
    const emit = (kind, payload = {}) => page.evaluate(({ kind, payload }) => window.emitFileDrag(kind, payload), { kind, payload });
    await settle();
    const original = await geometry();
    for (const id of ['peer-ui', 'peer-2', 'codex-ui', 'peer-2']) {
      await emit(id === 'peer-ui' ? 'enter' : 'over', { paths: ['C:\\drop\\example.png'], position: await position(id) });
      await expect(tile(id)).toHaveAttribute('data-file-drop-target', '');
      expect(await focus()).toBe('codex-ui');
      expect(await geometry()).toEqual(original);
    }
    await emit('leave');
    await expect(page.locator('[data-file-drop-target]')).toHaveCount(0);
    expect(await writes()).toEqual([]);

    // The drop target is captured before a slow filesystem check, even if
    // a later focus change puts a different panel under that coordinate.
    await page.evaluate(() => { window.deferDirectoryCheck = true; });
    await emit('drop', { paths: ['C:\\drop\\my image.png'], position: await position('peer-2') });
    await page.waitForFunction(() => !!window.finishDirectoryCheck);
    expect(await focus()).toBe('codex-ui');
    await page.evaluate(() => window.layout.getState().setFocused('peer-ui'));
    await settle();
    await page.evaluate(() => { window.finishDirectoryCheck(false); window.deferDirectoryCheck = false; delete window.finishDirectoryCheck; });
    await expect.poll(writes).toEqual([{ id: 'peer-2', data: '"C:\\drop\\my image.png"' }]);
    expect(await focus()).toBe('peer-2');
    await settle();
    await emit('drop', { paths: ['C:\\drop\\one.txt', 'C:\\drop\\two files.txt'], position: await position('peer-ui') });
    await expect.poll(writes).toHaveLength(2);
    expect((await writes())[1]).toEqual({ id: 'peer-ui', data: 'C:\\drop\\one.txt "C:\\drop\\two files.txt"' });
    await settle();

    const groupId = await page.evaluate(() => { window.createDropGroup(); return window.layout.getState().activeTabId; });
    await expect(tile(groupId)).toBeVisible();
    await settle();
    await emit('over', { position: await position(groupId) });
    await expect(page.locator('[data-file-drop-target]')).toHaveCount(0);
    await emit('drop', { paths: ['C:\\drop\\one.txt', 'C:\\drop\\two.txt'], position: await position(groupId) });
    await emit('drop', { paths: ['C:\\drop\\one.txt', 'C:\\drop\\two.txt'], position: { x: 2, y: 2 } });
    expect(await writes()).toHaveLength(2);

    const focusedBeforeFolder = await focus();
    await emit('drop', { paths: ['C:\\project-folder'], position: await position('peer-2') });
    await expect.poll(() => page.evaluate(() => window.droppedFolders)).toEqual(['C:\\project-folder']);
    expect(await focus()).toBe(focusedBeforeFolder);
    expect(await writes()).toHaveLength(2);

    await page.evaluate(() => { window.deferDirectoryCheck = true; });
    await emit('drop', { paths: ['C:\\drop\\late.txt'], position: await position('peer-2') });
    await page.waitForFunction(() => !!window.finishDirectoryCheck);
    await page.evaluate(() => { window.layout.getState().removePanel('peer-2'); window.finishDirectoryCheck(false); delete window.finishDirectoryCheck; });
    await settle();
    expect(await writes()).toHaveLength(2);

    await emit('enter', { paths: ['C:\\late-folder'], position: await position('codex-ui') });
    await expect(tile('codex-ui')).toHaveAttribute('data-file-drop-target', '');
    await emit('drop', { paths: ['C:\\late-folder'], position: await position('codex-ui') });
    await page.waitForFunction(() => !!window.finishDirectoryCheck);
    await emit('over', { position: await position('peer-ui') });
    await page.evaluate(() => { window.unmountFileDrop(); window.finishDirectoryCheck(true); });
    await expect(page.locator('[data-file-drop-target]')).toHaveCount(0);
    expect(await page.evaluate(() => window.droppedFolders)).toEqual(['C:\\project-folder']);
    expect(await writes()).toHaveLength(2);
    expect(errors).toEqual([]);
    console.log(`PASS file drag at ${deviceScaleFactor}x: stable geometry/focus, hover and cancel, exact delayed target, quoted multi-file input, rejected targets, folder routing, closed target and cleanup`);
    await context.close();
  }
} finally { await browser.close(); }
