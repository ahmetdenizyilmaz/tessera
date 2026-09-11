import type { Terminal } from "@xterm/xterm";

export type TerminalScrollState = {
  following: boolean;
  top: number;
  anchor: string[];
};

/** xterm owns ordinary scrolling and synchronized rendering. Preserve the
 * user's viewport only across a resize, transcript erase/replay, or remount. */
export function installTerminalScrollGuard(terminal: Terminal, saved?: TerminalScrollState) {
  const element = terminal.element;
  let state: TerminalScrollState = saved ? { ...saved, anchor: [...saved.anchor] }
    : { following: true, top: 0, anchor: [] };
  let needsRestore = !!saved;
  let erased = false;
  let frameEnded = false;
  let applying = false;
  let userScrolling = false;
  let pointer: { id: number; x: number; y: number; dragging: boolean } | undefined;
  let frame = 0;
  let gestureFrame = 0;
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
    if (disposed || applying || userScrolling || terminal.modes.synchronizedOutputMode ||
        terminal.buffer.active.type !== "normal") return;
    applying = true;
    try {
      const buffer = terminal.buffer.normal;
      if (state.following) {
        // ED3 can leave xterm's user-scroll state set while baseY is zero.
        // Wait for replay rows, then reattach once; normal output follows
        // through xterm itself instead of a scrollToBottom on every write.
        if (erased && buffer.baseY === 0) return;
        if (erased || buffer.viewportY !== buffer.baseY) terminal.scrollToBottom();
        state.top = buffer.viewportY;
      } else {
        const matches = (y: number) => state.anchor.some(Boolean) &&
          state.anchor.every((text, offset) => line(y + offset) === text);
        let closest: number | undefined;
        if (matches(state.top)) closest = state.top;
        else if (state.anchor.some(Boolean)) {
          for (let y = 0; y <= buffer.baseY; y++) {
            if (matches(y) && (closest === undefined || Math.abs(y - state.top) < Math.abs(closest - state.top))) closest = y;
          }
        }
        // Codex may send the erase before its synchronized replay starts.
        if (erased && closest === undefined && buffer.baseY < state.top && !frameEnded) return;
        state.top = closest ?? Math.min(state.top, buffer.baseY);
        if (buffer.viewportY !== state.top) terminal.scrollToLine(state.top);
      }
      needsRestore = false;
      erased = false;
    } finally { applying = false; }
  };
  const schedule = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (needsRestore) restore(); });
  };
  const resized = () => { needsRestore = true; schedule(); };
  const endGesture = () => {
    cancelAnimationFrame(gestureFrame);
    gestureFrame = requestAnimationFrame(() => {
      gestureFrame = 0;
      userScrolling = false;
      if (needsRestore) schedule();
    });
  };
  const revealInput = () => {
    if (disposed || terminal.buffer.active.type !== "normal") return;
    cancelAnimationFrame(gestureFrame);
    gestureFrame = 0;
    userScrolling = false;
    pointer = undefined;
    state = { following: true, top: terminal.buffer.normal.baseY, anchor: [] };
    restore();
  };
  const wheel = () => {
    if (terminal.buffer.active.type !== "normal" || terminal.modes.mouseTrackingMode !== "none") return;
    userScrolling = true;
    endGesture();
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const scrollbar = event.target instanceof Element && !!event.target.closest(".scrollbar");
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: scrollbar };
    // A focus click is not scrolling. Only the scrollbar or an actual text
    // selection drag can change the saved reading position.
    if (scrollbar) userScrolling = true;
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id || !(event.buttons & 1)) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) {
      pointer.dragging = true;
      userScrolling = true;
    }
  };
  const pointerUp = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dragging = pointer.dragging;
    pointer = undefined;
    if (dragging) endGesture();
  };
  const blur = () => { pointer = undefined; endGesture(); };
  const key = (event: KeyboardEvent) => {
    if (event.shiftKey && ["PageUp", "PageDown", "Home", "End"].includes(event.key)) wheel();
  };
  const scroll = () => {
    if (userScrolling && !applying && !needsRestore && !terminal.modes.synchronizedOutputMode) remember();
  };
  const erase = (params: (number | number[])[]) => {
    if (params[0] === 2 || params[0] === 3) {
      needsRestore = true;
      erased ||= params[0] === 3;
      frameEnded = false;
    }
    return false; // Observe the protocol; xterm still executes every byte.
  };
  element?.addEventListener("wheel", wheel, { capture: true, passive: true });
  element?.addEventListener("pointerdown", pointerDown, true);
  element?.addEventListener("keydown", key, true);
  element?.addEventListener("beforeinput", revealInput, true);
  element?.addEventListener("input", revealInput, true);
  element?.addEventListener("compositionstart", revealInput, true);
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerUp);
  window.addEventListener("blur", blur);
  const subscriptions = [
    terminal.onWriteParsed(() => { if (needsRestore) restore(); }),
    terminal.onScroll(scroll), terminal.onResize(resized), terminal.onKey(revealInput),
    terminal.parser.registerCsiHandler({ final: "J" }, erase),
    terminal.parser.registerCsiHandler({ prefix: "?", final: "J" }, erase),
    terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, params => {
      if (params.includes(2026)) frameEnded = true;
      return false;
    }),
  ];
  return {
    snapshot: () => ({ ...state, anchor: [...state.anchor] }),
    restore,
    revealInput,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(gestureFrame);
      subscriptions.forEach(s => s.dispose());
      element?.removeEventListener("wheel", wheel, true);
      element?.removeEventListener("pointerdown", pointerDown, true);
      element?.removeEventListener("keydown", key, true);
      element?.removeEventListener("beforeinput", revealInput, true);
      element?.removeEventListener("input", revealInput, true);
      element?.removeEventListener("compositionstart", revealInput, true);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("blur", blur);
    },
  };
}
