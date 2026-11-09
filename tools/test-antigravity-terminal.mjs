// Replay the real ConPTY capture from test-rust.ps1 -AntigravityTerminal in
// Tessera's xterm renderer, including resize and serialize/remount boundaries.
// Set TESSERA_AGY_RENDER_CAPTURE when running that native test, then:
//   node tools/test-antigravity-terminal.mjs path/to/capture.json
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const capture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
try {
  await page.setContent('<div id="terminal"></div>');
  await page.addScriptTag({ path: 'node_modules/@xterm/xterm/lib/xterm.js' });
  await page.addScriptTag({ path: 'node_modules/@xterm/addon-serialize/lib/addon-serialize.js' });
  await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' });
  const bundle = await build({ entryPoints: ['src/lib/terminalSnapshot.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'TesseraSnapshot' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const checks = await page.evaluate(async ({ events, remount }) => {
    let terminal, serialize, snapshotter;
    const create = (cols, rows) => {
      terminal = new window.Terminal({ cols, rows, scrollback: 10000,
        windowsPty: { backend: 'conpty', buildNumber: 26100 }, allowTransparency: true });
      serialize = new window.SerializeAddon.SerializeAddon();
      terminal.loadAddon(serialize);
      terminal.open(document.getElementById('terminal'));
      snapshotter = window.TesseraSnapshot.withTerminalState(terminal, serialize);
    };
    create(100, 30);
    const decoder = new TextDecoder();
    const write = data => new Promise(resolve => terminal.write(data, resolve));
    const screen = () => Array.from({ length: terminal.rows }, (_, row) =>
      terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)?.translateToString(true) || '');
    const checks = [];
    for (const event of events) {
      if (event.data) await write(decoder.decode(Uint8Array.from(event.data), { stream: true }));
      if (event.resize) terminal.resize(...event.resize);
      if (event.checkpoint) {
        const inspect = phase => {
          const lines = screen();
          checks.push({ label: `${event.checkpoint}: ${phase}`,
            prompt: lines.findLast(line => line.trimStart().startsWith('>'))?.trimEnd(),
            expected: event.prompt, cursor: [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY],
            staleDraft: lines.some(line => /resize draft|tessera redraw test/.test(line)) });
        };
        inspect('live');
        if (!remount) continue;
        const saved = snapshotter.serialize();
        const { cols, rows } = terminal;
        snapshotter.dispose(); terminal.dispose();
        create(cols, rows);
        await write(saved);
        inspect('restored');
      }
    }
    snapshotter.dispose(); terminal.dispose();
    return checks;
  }, { events: capture, remount: !process.env.TESSERA_AGY_NO_REMOUNT });
  expect(checks.length).toBeGreaterThanOrEqual(process.env.TESSERA_AGY_NO_REMOUNT ? 7 : 14);
  for (const check of checks) {
    expect(check.prompt, check.label).toBe(check.expected);
    expect(check.staleDraft, check.label).toBe(false);
  }
  console.log(`PASS real Antigravity ConPTY output in xterm: ${checks.length} draft, resize and remount checks`);
} finally {
  await browser.close();
}
