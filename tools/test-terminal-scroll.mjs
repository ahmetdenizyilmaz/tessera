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
    const windowsPty = { backend: 'conpty', buildNumber: 26200 };
    let terminal = new window.Terminal({ cols: 80, rows: 20, windowsPty });
    terminal.open(document.getElementById('terminal'));
    let guard = window.TesseraScroll.installTerminalScrollGuard(terminal);
    const write = data => new Promise(resolve => terminal.write(data, async () => { await frames(); resolve(); }));
    const history = Array.from({ length: 180 }, (_, i) => `history line ${i}`).join('\r\n');
    await write(history);
    const buffer = () => terminal.buffer.active;
    const atBottom = () => buffer().viewportY === buffer().baseY;
    const topText = () => buffer().getLine(buffer().viewportY)?.translateToString(true);
    const startsAtBottom = atBottom();
    const scrollbar = () => terminal.element.querySelector('.scrollbar.vertical');
    const dragTo = async y => {
      scrollbar().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      terminal.scrollToLine(y);
      window.dispatchEvent(new PointerEvent('pointerup'));
      await frames();
    };
    // A focus click during a real resize/redraw must not be saved as a
    // user's deliberate scroll to the top (the old guard did this).
    terminal.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    terminal.resize(80, 14);
    terminal.scrollToLine(0);
    window.dispatchEvent(new PointerEvent('pointerup'));
    await frames();
    const focusResizeKeepsFollowing = atBottom() && guard.snapshot().following;
    // A scrollbar drag is intentional and must be preserved during output.
    await dragTo(50);
    const anchor = topText();
    const userScrollKept = !guard.snapshot().following && buffer().viewportY === 50;
    await write('\r\nnew output\r\nmore output');
    const outputKeepsReadingPosition = topText() === anchor;
    // Real ConPTY chunks can separate ED3 from the synchronized replay.
    await write('\x1b[3J\x1b[2J\x1b[H');
    await write('\x1b[?2026h' + history.slice(0, 90));
    await write(history.slice(90) + '\r\nnew output\r\nmore output\x1b[?2026l');
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
    terminal = new window.Terminal({ cols: 60, rows: 14, windowsPty });
    terminal.open(document.getElementById('terminal'));
    guard = window.TesseraScroll.installTerminalScrollGuard(terminal, saved);
    await write(serialized);
    const remountKeepsReadingPosition = topText() === anchor;
    await dragTo(buffer().baseY);
    await write('\x1b[3J\x1b[2J\x1b[H' + history);
    const bottomFollowingSurvivesReplay = atBottom() && guard.snapshot().following;
    // Ordinary output belongs to xterm. The integration should not force
    // scrollToBottom for each chunk, which fights synchronized rendering.
    let forcedScrolls = 0;
    const scrollToBottom = terminal.scrollToBottom.bind(terminal);
    terminal.scrollToBottom = () => { forcedScrolls++; scrollToBottom(); };
    for (let i = 0; i < 5; i++) await write(`\r\nordinary output ${i}`);
    const ordinaryOutputUsesNativeFollow = atBottom() && forcedScrolls === 0;
    terminal.scrollToBottom = scrollToBottom;
    // Repeated panel size/focus changes retain the input and full history.
    for (const [cols, rows] of [[60, 28], [80, 10], [40, 22], [80, 20]]) {
      terminal.resize(cols, rows);
      terminal.focus();
      await frames();
      if (!atBottom()) throw new Error(`Lost bottom after resize to ${cols}x${rows}`);
    }
    document.getElementById('elsewhere').focus();
    await write('\r\nlatest output');
    const outputKeepsFocus = document.activeElement.id === 'elsewhere';
    await write('\x1b[?1049h\x1b[2Jmenu');
    const alternateScreenUnaffected = buffer().type === 'alternate' && buffer().viewportY === 0;
    await write('\x1b[?1049l');
    const normalBufferRestored = buffer().type === 'normal' && atBottom();
    window.scrollTestTerminal = terminal;
    window.scrollTestGuard = guard;
    return { startsAtBottom, focusResizeKeepsFollowing, userScrollKept, outputKeepsReadingPosition,
      transcriptReplayKeepsAnchor, resizeKeepsReadingPosition, remountKeepsReadingPosition,
      bottomFollowingSurvivesReplay, ordinaryOutputUsesNativeFollow, outputKeepsFocus, alternateScreenUnaffected, normalBufferRestored };
  });
  for (const [name, passed] of Object.entries(result)) expect(passed, name).toBe(true);
  await page.locator('#terminal').hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(() => page.evaluate(() => window.scrollTestGuard.snapshot().following)).toBe(false);
  await page.mouse.wheel(0, 100000);
  await expect.poll(() => page.evaluate(() => window.scrollTestGuard.snapshot().following)).toBe(true);

  const input = page.locator('.xterm-helper-textarea');
  const atInput = () => page.evaluate(() => {
    const buffer = window.scrollTestTerminal.buffer.active;
    return window.scrollTestGuard.snapshot().following && buffer.viewportY === buffer.baseY;
  });
  const readHistory = async () => {
    await page.locator('#terminal').hover();
    await page.mouse.wheel(0, -400);
    await expect.poll(() => page.evaluate(() => window.scrollTestGuard.snapshot().following)).toBe(false);
    await input.focus();
  };
  await page.evaluate(() => {
    window.terminalInput = [];
    window.scrollTestTerminal.onData(data => window.terminalInput.push(data));
  });
  await readHistory();
  const readingRow = await page.evaluate(() => window.scrollTestTerminal.buffer.active.viewportY);
  // A terminal's cursor-position reply is output-driven, not a user editing
  // the prompt. Treating every onData callback as typing would undo the fix.
  await page.evaluate(() => new Promise(resolve => window.scrollTestTerminal.write('\x1b[6n', resolve)));
  await input.press('Shift');
  await expect.poll(() => page.evaluate(() => window.scrollTestTerminal.buffer.active.viewportY)).toBe(readingRow);
  await expect.poll(atInput).toBe(false);
  await page.evaluate(() => { window.terminalInput = []; });
  await input.pressSequentially('draft');
  await expect.poll(atInput, { message: 'Typing must bring the prompt back into view' }).toBe(true);
  expect(await page.evaluate(() => window.terminalInput.join(''))).toBe('draft');
  await page.evaluate(() => new Promise(resolve => window.scrollTestTerminal.write('\r\nworking output', resolve)));
  await expect.poll(atInput).toBe(true);
  await readHistory();
  await input.press('Shift+PageUp');
  await expect.poll(atInput).toBe(false);
  await input.press('Backspace');
  await expect.poll(atInput).toBe(true);
  await readHistory();
  await page.keyboard.insertText('\u00dc\u0131');
  await expect.poll(atInput, { message: 'Text input without keydown must reveal the prompt' }).toBe(true);
  expect(await page.evaluate(() => window.terminalInput.join(''))).toContain('\u00dc\u0131');
  await readHistory();
  await input.dispatchEvent('compositionstart', { data: '' });
  await expect.poll(atInput, { message: 'IME composition must reveal the prompt' }).toBe(true);
  await input.dispatchEvent('compositionend', { data: '' });
  console.log('PASS terminal scroll: focus clicks, native following, chunked synchronized replay, ConPTY resize, remount, reading anchors, wheel gestures, alternate screen and focus');
  console.log('PASS terminal input: typing, editing and IME reveal the prompt; scroll keys and terminal replies preserve history');
  await page.evaluate(() => { window.scrollTestGuard.dispose(); window.scrollTestTerminal.dispose(); });
} finally { await browser.close(); }
