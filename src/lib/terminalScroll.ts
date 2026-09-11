import type { Terminal } from "@xterm/xterm";

export type TerminalScrollState = {
  following: boolean;
  top: number;
  anchor: string[];
};

/** Keep user scroll intent separate from scroll events caused by TUI redraws,
 * buffer clears, layout changes, and the browser clamping its scrollbar. */
export function installTerminalScrollGuard(terminal: Terminal, saved?: TerminalScrollState) {
  const element = terminal.element;
  const viewport = element?.querySelector<HTMLElement>(".xterm-viewport");
  let state: TerminalScrollState = saved ? { ...saved, anchor: [...saved.anchor] }
    : { following: true, top: 0, anchor: [] };
  let applying = false;
  let userScrolling = false;
  let dragging = false;
  let frame = 0;
  let userScrollFrame = 0;
  let disposed = false;
  const line = (y: number) => terminal.buffer.normal.getLine(y)?.translateToString(true) ?? "";
  const remember = () => {
    const buffer = terminal.buffer.active;
    if (buffer.type !== "normal") return;
    state = {
      following: buffer.baseY - buffer.viewportY <= 1,
      top: buffer.viewportY,
      anchor: [0, 1, 2].map(offset => line(buffer.viewportY + offset)),
    };
  };
  const restore = () => {
    if (disposed || applying || userScrolling || dragging || terminal.buffer.active.type !== "normal") return;
    applying = true;
    try {
      const buffer = terminal.buffer.normal;
      if (state.following) {
        // Also resets xterm's internal isUserScrolling after an erased buffer,
        // even when viewportY and baseY are both temporarily zero.
        terminal.scrollToBottom();
        state.top = buffer.viewportY;
      } else {
        const matches = (y: number) => state.anchor.length > 0 && state.anchor.some(Boolean) &&
          state.anchor.every((text, offset) => line(y + offset) === text);
        if (state.anchor.some(Boolean) && !matches(state.top)) {
          // Full-screen transcript replay invalidates numeric line positions.
          // Re-anchor to visible text, choosing the closest repeated match.
          let closest: number | undefined;
          for (let y = 0; y <= buffer.baseY; y++) {
            if (matches(y) && (closest === undefined || Math.abs(y - state.top) < Math.abs(closest - state.top))) closest = y;
          }
          if (closest !== undefined) state.top = closest;
        }
        terminal.scrollToLine(Math.min(state.top, buffer.baseY));
      }
    } finally { applying = false; }
  };
  const schedule = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; restore(); });
  };
  const endUserScroll = () => {
    cancelAnimationFrame(userScrollFrame);
    userScrollFrame = requestAnimationFrame(() => {
      userScrollFrame = 0;
      if (disposed) return;
      remember();
      userScrolling = false;
    });
  };
  const revealInput = () => {
    if (disposed || terminal.buffer.active.type !== "normal") return;
    // Editing ends history browsing. Otherwise our redraw protection undoes
    // xterm's scroll-on-input and the keystrokes land in an invisible prompt.
    cancelAnimationFrame(userScrollFrame);
    userScrollFrame = 0;
    userScrolling = false;
    dragging = false;
    state = { following: true, top: terminal.buffer.normal.baseY, anchor: [] };
    restore();
  };
  const wheel = () => { userScrolling = true; endUserScroll(); };
  const pointerDown = (event: PointerEvent) => {
    // Include text-selection drags: xterm scrolls while a selection extends
    // beyond the viewport, even though the scrollbar itself was not grabbed.
    if (event.button === 0 && element?.contains(event.target as Node)) {
      dragging = true; userScrolling = true;
    }
  };
  const pointerUp = () => {
    if (!dragging) return;
    dragging = false;
    endUserScroll();
  };
  const key = (event: KeyboardEvent) => {
    if (event.shiftKey && ["PageUp", "PageDown", "Home", "End"].includes(event.key)) wheel();
  };
  const scroll = () => {
    if (applying) return;
    if (userScrolling || dragging) remember();
    else schedule();
  };
  element?.addEventListener("wheel", wheel, { capture: true, passive: true });
  element?.addEventListener("pointerdown", pointerDown, true);
  element?.addEventListener("keydown", key, true);
  // IMEs and emoji input can bypass onKey. These events only come from the
  // editor; onData also contains automatic terminal replies and is unsuitable.
  element?.addEventListener("beforeinput", revealInput, true);
  element?.addEventListener("input", revealInput, true);
  element?.addEventListener("compositionstart", revealInput, true);
  viewport?.addEventListener("scroll", scroll);
  window.addEventListener("pointerup", pointerUp);
  const subscriptions = [
    terminal.onWriteParsed(restore), terminal.onScroll(scroll), terminal.onResize(schedule),
    terminal.onKey(revealInput),
  ];
  return {
    snapshot: () => ({ ...state, anchor: [...state.anchor] }),
    restore,
    revealInput,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(userScrollFrame);
      subscriptions.forEach(s => s.dispose());
      element?.removeEventListener("wheel", wheel, true);
      element?.removeEventListener("pointerdown", pointerDown, true);
      element?.removeEventListener("keydown", key, true);
      element?.removeEventListener("beforeinput", revealInput, true);
      element?.removeEventListener("input", revealInput, true);
      element?.removeEventListener("compositionstart", revealInput, true);
      viewport?.removeEventListener("scroll", scroll);
      window.removeEventListener("pointerup", pointerUp);
    },
  };
}
