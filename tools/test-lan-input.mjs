// Real React/xterm in two isolated browser contexts; no real user sessions.
// Run with Vite on 1420: node tools/test-lan-input.mjs [base-url]
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const owner = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const viewer = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
const writes = [];
let hold;
let session = 'pty-one';
let queries = false;
for (const page of [owner, viewer]) {
  page.on('pageerror', error => { if (error.message !== 'WebSocket closed without opened.') errors.push(error.message); });
  await page.route('**/lan-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/lan-ui-fixture.jsx"></script>` }));
}
await viewer.exposeFunction('readRemote', async panelId => {
  const snapshot = await owner.evaluate(id => window.readSharedTerminal(id), panelId);
  return { ...snapshot, inputSession: session, connectionId: 'connection-one',
    data: snapshot.data + (queries ? '\x1b[6n\x1b[c\x1b[?1004h\x1b]10;?\x1b\\' : '') };
});
await viewer.exposeFunction('writeRemote', async args => {
  writes.push(args);
  if (hold) await hold.promise;
  return { delivered: true };
});
const tile = viewer.locator('[data-fixture-id="host-claude"]');
const input = tile.locator('.xterm-helper-textarea');
const ready = () => expect.poll(() => viewer.evaluate(() => !window.terminals.get('host-claude')?.options.disableStdin)).toBe(true);
const type = async text => { await input.focus(); await viewer.keyboard.type(text); };
const sent = () => writes.map(write => write.data).join('');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
try {
  for (const page of [owner, viewer]) {
    await page.goto(`${process.argv[2] || 'http://127.0.0.1:1420'}/lan-test`);
    await page.waitForFunction(() => !!window.showOwner);
  }
  await owner.evaluate(() => window.showOwner());
  await expect.poll(() => owner.evaluate(() => window.terminals.size)).toBe(2);
  await owner.evaluate(() => window.output('host-claude', '\x1b[?2004hHost prompt> '));
  await viewer.evaluate(() => window.showViewer());
  await ready();
  await expect(tile.locator('textarea:not(.xterm-helper-textarea)')).toHaveCount(0);
  await expect(viewer.locator('[data-fixture-id="host-chat"] textarea')).toHaveCount(1);
  await expect(viewer.locator('[data-fixture-id="host-chat"] .xterm')).toHaveCount(0);
  expect(writes).toEqual([]);
  await type('thanks');
  await viewer.keyboard.press('ArrowUp'); await viewer.keyboard.press('Tab');
  await viewer.keyboard.press('Control+c'); await viewer.keyboard.press('Enter');
  await expect.poll(sent).toBe('thanks\x1b[A\t\x03\r');
  expect(writes.every(write => write.deviceId === 'owner' && write.panelId === 'host-claude'
    && write.inputSession === 'pty-one' && write.connectionId === 'connection-one')).toBe(true);
  console.log('PASS panel types match owner; direct keys/control/menu keys target the exact remote terminal without wrappers');

  writes.length = 0;
  await viewer.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    readText: async () => 'Ünye\n  漢字', writeText: async text => { window.copied = text; },
  } }));
  await viewer.keyboard.press('Control+v');
  await expect.poll(sent).toBe('\x1b[200~Ünye\r  漢字\x1b[201~');
  expect(writes).toHaveLength(1);
  writes.length = 0;
  await input.evaluate(node => {
    const data = new DataTransfer(); data.setData('text/plain', 'context paste');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(sent).toBe('\x1b[200~context paste\x1b[201~');
  expect(writes).toHaveLength(1);
  writes.length = 0;
  await viewer.keyboard.insertText('你好');
  await expect.poll(sent).toBe('你好');
  console.log('PASS Unicode/IME input and multiline bracketed paste arrive once, without an extra Enter');

  writes.length = 0;
  queries = true;
  await tile.getByTitle('Refresh terminal screen').click();
  await ready();
  await input.focus();
  await viewer.locator('[data-fixture-id="host-chat"] textarea').focus();
  await type('x');
  await expect.poll(sent).toBe('x');
  await viewer.waitForTimeout(600);
  expect(sent()).toBe('x');
  queries = false;
  console.log('PASS screen queries and focus reports never become host input');

  writes.length = 0;
  await viewer.evaluate(() => window.setInputSupported(false));
  await expect(tile.getByText('Read-only.', { exact: false })).toBeVisible();
  await type('old host'); await viewer.keyboard.press('Enter');
  expect(writes).toEqual([]);
  await viewer.evaluate(() => window.setInputSupported(true)); await ready();
  console.log('PASS older hosts stay read-only with an update notice and no message-composer fallback');

  hold = deferred();
  await type('first'); await viewer.keyboard.press('Enter');
  await expect.poll(() => writes.length).toBe(1);
  await viewer.evaluate(() => window.setConnected(false));
  hold.resolve(); hold = undefined;
  await viewer.evaluate(() => window.setConnected(true)); await ready();
  await type('fresh'); await expect.poll(sent).toBe('ffresh');
  console.log('PASS disconnect drops queued keystrokes and Enter instead of replaying them after reconnect');

  writes.length = 0;
  hold = deferred();
  await type('abc'); await viewer.keyboard.press('Enter');
  await expect.poll(() => writes.length).toBe(1);
  hold.reject(new Error('fixture timeout')); hold = undefined;
  await expect(tile.getByRole('alert')).toContainText('Unsent keys were discarded');
  await type('blocked'); expect(sent()).toBe('a');
  await tile.getByTitle('Refresh terminal screen').click(); await ready();
  await type('ok'); await expect.poll(sent).toBe('aok');
  console.log('PASS ambiguous delivery failures stop input; refresh resumes without automatic retry');

  writes.length = 0;
  hold = deferred();
  await type('old'); await viewer.keyboard.press('Enter');
  await expect.poll(() => writes.length).toBe(1);
  session = 'pty-two';
  await expect.poll(() => viewer.evaluate(() => window.calls.filter(call => call.command === 'lan_read_terminal').length)).toBeGreaterThan(2);
  // Wait for the complete new-session frame to replace the old lease.
  await viewer.waitForTimeout(700);
  hold.resolve(); hold = undefined;
  await type('new'); await expect.poll(sent).toBe('onew');
  expect(writes.slice(1).every(write => write.inputSession === 'pty-two')).toBe(true);
  console.log('PASS a host PTY restart drops old queued input and uses only the new session token');

  const chat = viewer.locator('[data-fixture-id="host-chat"] textarea');
  await chat.fill('  thanks\n  indented');
  await viewer.locator('[data-fixture-id="host-chat"]').getByTitle('Send to remote panel').click();
  await expect.poll(() => viewer.evaluate(() => window.calls.filter(call => call.command === 'lan_send_panel').map(call => call.args.message))).toEqual(['  thanks\n  indented']);
  writes.length = 0;
  hold = deferred(); await type('closing'); await viewer.keyboard.press('Enter');
  await expect.poll(() => writes.length).toBe(1);
  await tile.getByRole('button', { name: 'Close remote panel locally' }).click();
  hold.resolve(); hold = undefined;
  await expect(tile).toHaveCount(0);
  await viewer.waitForTimeout(300);
  expect(sent()).toBe('c');
  expect(await viewer.evaluate(() => window.calls.filter(call => /^(pty_|codex_terminal_|opencode_terminal_)/.test(call.command)))).toEqual([]);
  expect(errors).toEqual([]);
  console.log('PASS chat composer preserves text; closing a remote terminal discards queued input without affecting host sessions');
} finally {
  hold?.resolve();
  await browser.close();
}
