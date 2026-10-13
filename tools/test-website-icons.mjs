import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const base = process.argv[2] ?? 'http://127.0.0.1:1420', errors = [];
page.on('pageerror', e => { if (!e.message.includes('WebSocket closed')) errors.push(e.message); });
await page.route('**/website-icon-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
<script type="module" src="/tools/new-session-focus-fixture.jsx"></script>` }));
const installIconServer = () => page.evaluate(() => {
  const original = window.__TAURI_INTERNALS__.invoke;
  window.iconCalls = [];
  window.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
    if (command !== 'website_icon_fetch') return original(command, args, options);
    window.iconCalls.push(args);
    if (args.url.includes('absent.test')) throw new Error('No icon here');
    if (args.kind === 'document') {
      if (args.url.includes('fallback.test')) throw new Error('Page unavailable');
      return { url: new URL('/redirect/page', args.url).href, contentType: 'text/html', body:
        '<base href="/assets/"><link rel="preload" href="ignored.png"><link rel="icon" href="broken.ico"><link rel="SHORTCUT ICON" href="mark.svg">' };
    }
    if (args.url.endsWith('broken.ico')) return { url: args.url, contentType: 'image/x-icon', body: btoa('not an image') };
    return { url: args.url, contentType: 'image/svg+xml', body: btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="4" y="4" width="56" height="56" rx="14" fill="#4d98ff"/><path d="M18 19h28v8H36v21h-8V27H18z" fill="white"/></svg>') };
  };
});
async function form(name, url) {
  await page.evaluate(() => window.newSession());
  await page.getByRole('button', { name: 'Add web app', exact: true }).click();
  const el = page.getByRole('form', { name: 'Add web app' });
  await expect(el.getByRole('button', { name: 'Automatic website icon' })).toHaveAttribute('aria-pressed', 'true');
  await el.getByLabel('Name', { exact: true }).fill(name);
  await el.getByLabel('Web address').fill(url);
  return el;
}
try {
  await page.goto(`${base}/website-icon-test`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.newSession); await installIconServer();
  let el = await form('Auto player', 'https://icons.example.test/player');
  await el.getByRole('button', { name: 'Add and open' }).click();
  await expect(page.locator('.browser-toolbar img')).toHaveCount(1);
  const app = await page.evaluate(() => [...window.plugins.getState().registry.values()].find(m => m.defaultTitle === 'Auto player'));
  expect(app.icon).toBe(''); expect(app.favicon).toMatch(/^data:image\/png;base64,/);
  expect(await page.locator('.browser-toolbar img').evaluate(img => [img.naturalWidth, img.naturalHeight])).toEqual([64, 64]);
  expect(await page.evaluate(() => window.iconCalls.map(c => c.url))).toEqual([
    'https://icons.example.test/player', 'https://icons.example.test/assets/broken.ico', 'https://icons.example.test/assets/mark.svg',
  ]);
  await expect(page.locator('.tab-item').filter({ hasText: 'Auto player' }).locator('img')).toHaveCount(1);
  console.log('PASS default automatic icon, redirected relative links, case-insensitive rel, invalid-image fallback, SVG-to-PNG conversion, and toolbar/tab updates');

  await page.reload(); await page.waitForFunction(() => !!window.newSession); await installIconServer();
  await page.evaluate(() => window.newSession());
  const shortcut = page.locator('.nsw-more').getByRole('button', { name: 'Auto player', exact: true });
  await expect(shortcut.locator('img')).toHaveCount(1); await shortcut.click();
  await expect(page.locator('.browser-toolbar img')).toHaveCount(1);
  expect(await page.evaluate(() => window.iconCalls)).toEqual([]);
  expect(await page.evaluate(name => window.plugins.getState().registry.get(name).browserSite, app.name)).toBe(app.name);
  console.log('PASS cached icon on reload, shortcut icon, no extra request, and unchanged cookie profile identity');

  el = await form('Manual player', 'https://manual.test');
  await el.getByRole('button', { name: 'Music icon' }).click(); await el.getByRole('button', { name: 'Add and open' }).click();
  expect(await page.evaluate(() => window.iconCalls)).toEqual([]);
  await page.getByRole('button', { name: 'Manual player view settings' }).click();
  await page.getByRole('button', { name: 'Use website icon', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh icon', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog').locator('.browser-settings-icon img')).toHaveCount(1);
  await page.keyboard.press('Escape');
  console.log('PASS manual icons are preserved and an existing app can switch to automatic in settings');

  await page.evaluate(() => {
    window.plugins.getState().addWebApp({ name: 'Fallback', url: 'https://fallback.test', icon: '' });
    window.plugins.getState().addWebApp({ name: 'No favicon', url: 'https://absent.test', icon: '' });
  });
  await expect.poll(() => page.evaluate(() => !![...window.plugins.getState().registry.values()].find(m => m.defaultTitle === 'Fallback')?.favicon)).toBe(true);
  expect(await page.evaluate(() => window.iconCalls.some(c => c.url === 'https://fallback.test/favicon.ico'))).toBe(true);
  await page.evaluate(() => window.newSession());
  await expect(page.locator('.nsw-more').getByRole('button', { name: 'No favicon', exact: true }).locator('svg.lucide-globe')).toHaveCount(1);

  // Choosing a manual icon while the network request is pending must win.
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command === 'website_icon_fetch' && args.url.includes('slow.test') && args.kind === 'document') await new Promise(resolve => { window.releaseIcon = resolve; });
      return original(command, args, options);
    };
    window.slowIconApp = window.plugins.getState().addWebApp({ name: 'Slow', url: 'https://slow.test', icon: '' });
    window.plugins.getState().setWebAppIcon(window.slowIconApp, 'Music');
    window.releaseIcon();
  });
  await expect.poll(() => page.evaluate(() => window.iconCalls.some(c => c.url === 'https://slow.test/assets/mark.svg'))).toBe(true);
  expect(await page.evaluate(() => window.plugins.getState().registry.get(window.slowIconApp).icon)).toBe('Music');
  expect(errors).toEqual([]);
  console.log('PASS root favicon fallback, missing-icon globe, and manual override during an outstanding request');
} finally { await browser.close(); }
