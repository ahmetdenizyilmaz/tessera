import type { Terminal } from "@xterm/xterm";

/**
 * ConPTY can expose a redraw's temporary cursor at the spinner/footer even
 * when Codex restores it correctly in the next write. Keep the display caret
 * in the composer during a working turn. Never move the terminal's real
 * cursor or rewrite PTY bytes: CPR responses, selection, typing and IME still
 * belong to xterm. Menus and idle sessions keep the native cursor.
 */
export function installTerminalCursorGuard(
  terminal: Terminal,
  isWorking: () => boolean,
) {
  const element = terminal.element;
  const screen = element?.querySelector<HTMLElement>(".xterm-screen");
  if (!element || !screen) return { dispose() {} };
  const caret = document.createElement("div");
  caret.className = "terminal-input-caret";
  caret.setAttribute("aria-hidden", "true");
  screen.append(caret);
  let requestedVisible = true;
  let column = 2;
  let offset = 0;
  const reset = () => {
    element.classList.remove("terminal-cursor-guarded");
    caret.hidden = true;
  };
  const update = () => {
    // xterm owns synchronized rendering; never paint an overlay from a
    // half-parsed frame over the previously completed native frame.
    if (terminal.modes.synchronizedOutputMode) return;
    const buffer = terminal.buffer.active;
    if (
      !isWorking() ||
      !requestedVisible ||
      buffer.type !== "normal" ||
      buffer.viewportY !== buffer.baseY
    ) {
      reset();
      return;
    }
    const lines = Array.from(
      { length: terminal.rows },
      (_, y) => buffer.getLine(buffer.baseY + y)?.translateToString(true) || "",
    );
    // Only the last visible input prompt, never an earlier user message.
    let prompt = -1;
    for (let y = lines.length - 1; y >= 0; y--) {
      if (/^\s*[›❯]\s/.test(lines[y]) || /^[›❯]$/.test(lines[y].trim())) {
        prompt = y;
        break;
      }
    }
    if (prompt < 0) {
      reset();
      return;
    }
    // The model/shortcut footer follows a blank separator. Explicit newlines
    // and wrapped drafts between the prompt and that footer remain editable.
    const footer = lines.findIndex(
      (line, y) =>
        y > prompt &&
        /^\s*(?:gpt-|o[134](?:-|\s)|\? for shortcuts|\d+% context left)/.test(
          line,
        ),
    );
    let end = footer > prompt ? Math.max(prompt, footer - 2) : prompt;
    while (
      end + 1 < terminal.rows &&
      buffer.getLine(buffer.baseY + end + 1)?.isWrapped
    )
      end++;
    if (buffer.cursorY >= prompt && buffer.cursorY <= end) {
      column = Math.min(buffer.cursorX, terminal.cols - 1);
      offset = buffer.cursorY - prompt;
      reset();
      return;
    }
    const cellWidth = screen.clientWidth / terminal.cols;
    const cellHeight = screen.clientHeight / terminal.rows;
    element.classList.add("terminal-cursor-guarded");
    caret.style.left = `${Math.min(column, terminal.cols - 1) * cellWidth}px`;
    caret.style.top = `${Math.min(prompt + offset, end) * cellHeight}px`;
    caret.style.width = `${cellWidth}px`;
    caret.style.height = `${cellHeight}px`;
    caret.hidden = false;
  };
  const subscriptions = [
    terminal.parser.registerCsiHandler(
      { prefix: "?", final: "h" },
      (params) => {
        if (params.includes(25)) requestedVisible = true;
        return false;
      },
    ),
    terminal.parser.registerCsiHandler(
      { prefix: "?", final: "l" },
      (params) => {
        if (params.includes(25)) requestedVisible = false;
        return false;
      },
    ),
    // Runs before the browser paints the new cursor; onRender also updates
    // overlay geometry after font changes and resizes.
    terminal.onWriteParsed(update),
    terminal.onRender(update),
    terminal.onScroll(update),
    terminal.onResize(() => {
      column = 2;
      offset = 0;
      update();
    }),
  ];
  reset();
  return {
    update,
    dispose() {
      subscriptions.forEach((s) => s.dispose());
      reset();
      caret.remove();
    },
  };
}
