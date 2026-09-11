// Real xterm scrollback/redraw regression checks; no CLI or user sessions.
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
try {
  await page.setContent('<div id="terminal"></div><input id="elsewhere" />');
  await page.addScriptTag({ path: 'node_modules/@xterm/xterm/lib/xterm.js' });
  await page.addScriptTag({ path: 'node_modules/@xterm/addon-serialize/lib/addon-serialize.js' });
  await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' });
  const bundle = await build({ entryPoints: ['src/lib/terminalScroll.ts'], bundle: true, write: false, format: 'iife', globalName: 'TesseraScroll' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const frames = async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    };
    let terminal = new window.Terminal({ cols: 80, rows: 20 });
    terminal.open(document.getElementById('terminal'));
    let guard = window.TesseraScroll.installTerminalScrollGuard(terminal);
    const write = data => new Promise(resolve => terminal.write(data, async () => { await frames(); resolve(); }));
    const history = Array.from({ length: 180 }, (_, i) => `history line ${i}`).join('\r\n');
    await write(history);
    const buffer = () => terminal.buffer.active;
    const atBottom = () => buffer().viewportY === buffer().baseY;
    const topText = () => buffer().getLine(buffer().viewportY)?.translateToString(true);
    const startsAtBottom = atBottom();
    const viewport = () => terminal.element.querySelector('.xterm-viewport');
    // Browser/layout scroll reset without a user gesture.
    viewport().scrollTop = 0;
    viewport().dispatchEvent(new Event('scroll'));
    await frames();
    const redrawResetRecovers = atBottom();
    // A scrollbar drag is intentional and must be preserved during output.
    viewport().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    terminal.scrollToLine(50);
    window.dispatchEvent(new PointerEvent('pointerup'));
    await frames();
    const anchor = topText();
    const userScrollKept = !guard.snapshot().following && buffer().viewportY === 50;
    await write('\r\nnew output\r\nmore output');
    const outputKeepsReadingPosition = topText() === anchor;
    await write('\x1b[3J\x1b[2J\x1b[H' + history + '\r\nnew output\r\nmore output');
    const transcriptReplayKeepsAnchor = topText() === anchor;
    terminal.resize(60, 14);
    await frames();
    const resizeKeepsReadingPosition = topText() === anchor;
    // Serialize/remount as a group switch does.
    const saved = guard.snapshot();
    const serializer = new window.SerializeAddon.SerializeAddon();
    terminal.loadAddon(serializer);
    const serialized = serializer.serialize();
    guard.dispose(); terminal.dispose();
    terminal = new window.Terminal({ cols: 60, rows: 14 });
    terminal.open(document.getElementById('terminal'));
    guard = window.TesseraScroll.installTerminalScrollGuard(terminal, saved);
    await write(serialized);
    const remountKeepsReadingPosition = topText() === anchor;
    viewport().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    terminal.scrollToBottom();
    window.dispatchEvent(new PointerEvent('pointerup'));
    await frames();
    await write('\x1b[3J\x1b[2J\x1b[H' + history);
    const bottomFollowingSurvivesReplay = atBottom() && guard.snapshot().following;
    document.getElementById('elsewhere').focus();
    await write('\r\nlatest output');
    const outputKeepsFocus = document.activeElement.id === 'elsewhere';
    await write('\x1b[?1049h\x1b[2Jmenu');
    const alternateScreenUnaffected = buffer().type === 'alternate' && buffer().viewportY === 0;
    await write('\x1b[?1049l');
    const normalBufferRestored = buffer().type === 'normal' && atBottom();
    window.scrollTestTerminal = terminal;
    window.scrollTestGuard = guard;
    return { startsAtBottom, redrawResetRecovers, userScrollKept, outputKeepsReadingPosition,
      transcriptReplayKeepsAnchor, resizeKeepsReadingPosition, remountKeepsReadingPosition,
      bottomFollowingSurvivesReplay, outputKeepsFocus, alternateScreenUnaffected, normalBufferRestored };
  });
  for (const [name, passed] of Object.entries(result)) expect(passed, name).toBe(true);
  await page.locator('#terminal').hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(() => page.evaluate(() => window.scrollTestGuard.snapshot().following)).toBe(false);
  await page.mouse.wheel(0, 100000);
  await expect.poll(() => page.evaluate(() => window.scrollTestGuard.snapshot().following)).toBe(true);
  console.log('PASS terminal scroll: browser resets, output, transcript replay, resize, remount, reading anchors, wheel gestures, alternate screen and focus');
  await page.evaluate(() => { window.scrollTestGuard.dispose(); window.scrollTestTerminal.dispose(); });
} finally { await browser.close(); }
