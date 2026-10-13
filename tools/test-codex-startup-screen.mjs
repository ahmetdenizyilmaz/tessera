// Replay isolated native-startup test captures in the same xterm parser used
// by Tessera. An Escape write alone does not prove the popup disappeared.
// Usage: node tools/test-codex-startup-screen.mjs .tmp/codex-startup-<id> [...]
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const roots = process.argv.slice(2);
if (!roots.length) throw new Error('Pass native startup capture directories');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.TESSERA_TEST_URL ?? 'http://127.0.0.1:1420');
  for (const root of roots) {
    const size = JSON.parse(readFileSync(join(root, 'terminal-size.json'), 'utf8'));
    const output = readFileSync(join(root, 'terminal-output.txt'), 'utf8');
    const screen = await page.evaluate(async ({ size, output }) => {
      const { Terminal } = await import('/node_modules/@xterm/xterm/lib/xterm.mjs');
      const terminal = new Terminal({ cols: size.cols, rows: size.rows, allowProposedApi: true });
      const host = document.createElement('div'); document.body.replaceChildren(host); terminal.open(host);
      let offset = 0;
      for (const resize of size.resizes ?? []) {
        await new Promise(resolve => terminal.write(output.slice(offset, resize.offset), resolve));
        terminal.resize(resize.cols, resize.rows); offset = resize.offset;
      }
      await new Promise(resolve => terminal.write(output.slice(offset), resolve));
      const buffer = terminal.buffer.active;
      const screen = Array.from({ length: terminal.rows }, (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? '').join('\n');
      terminal.dispose(); host.remove();
      return screen;
    }, { size, output });
    expect(screen, root).not.toContain('Resume paused goal?');
    expect(screen, root).not.toContain('1. Resume goal');
    expect(screen, root).toContain('Ask Codex');
    console.log(`PASS dismissed on actual xterm screen (${size.cols}x${size.rows}): ${root}`);
  }
} finally { await browser.close(); }
