import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

type Size = { cols: number; rows: number };
const same = (a: Size | undefined, b: Size | undefined) =>
  !!a && !!b && a.cols === b.cols && a.rows === b.rows;

/** One owner for font, visibility and layout sizing. Native resize requests
 * are ordered and coalesced; unchanged geometry never reaches ConPTY. */
export function createTerminalResize(
  terminal: Terminal,
  fit: FitAddon,
  resize: (cols: number, rows: number) => Promise<void>,
  isActive: () => boolean = () => true,
) {
  const view = terminal.element?.ownerDocument.defaultView ?? window;
  const requestAnimationFrame = view.requestAnimationFrame.bind(view);
  const cancelAnimationFrame = view.cancelAnimationFrame.bind(view);
  let frame = 0;
  let settled = 0;
  let restoring = false;
  let started = false;
  let disposed = false;
  let sending = false;
  let desired: Size | undefined;
  let sent: Size | undefined;
  const send = async () => {
    if (disposed || restoring || !started || !isActive() || sending || !desired || same(desired, sent)) return;
    const size = desired;
    sending = true;
    try {
      await resize(size.cols, size.rows);
      sent = size;
      if (!disposed) terminal.refresh(0, terminal.rows - 1);
    } catch (error) {
      console.error("Terminal resize failed:", error);
    } finally {
      sending = false;
      if (!same(desired, size)) void send();
    }
  };
  const fitNow = () => {
    if (disposed || restoring) return;
    // Inactive tiles are previews of a live terminal. Shrinking their PTY
    // makes native TUIs erase/replay history, only to repeat that work when
    // the user returns. Establish initial geometry, then fit active views.
    if (started && !isActive()) return;
    const bounds = terminal.element?.parentElement?.getBoundingClientRect();
    // A hidden view has no meaningful geometry. FitAddon otherwise clamps
    // it to 2x1, which would make the CLI rewrite its transcript on return.
    if (!bounds?.width || !bounds.height) return;
    const size = fit.proposeDimensions();
    if (!size || size.cols < 2 || size.rows < 1) return;
    if (terminal.cols !== size.cols || terminal.rows !== size.rows) fit.fit();
    desired = { cols: terminal.cols, rows: terminal.rows };
    // Repaint even if the character grid stayed the same: moving a window,
    // revealing a clipped panel or finishing a CSS transition can invalidate
    // the renderer without changing cols/rows. This does not send input.
    terminal.refresh(0, terminal.rows - 1);
    void send();
    return desired;
  };
  return {
    fitNow,
    pauseForRestore() { restoring = true; },
    finishRestore() { restoring = false; },
    requestFit() {
      if (disposed) return;
      view.clearTimeout(settled);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Coalesce the intermediate sizes of a drag into its settled size.
        settled = view.setTimeout(() => {
          settled = 0;
          // Parse queued output at its original geometry before fitting.
          terminal.write('', () => { if (!disposed) fitNow(); });
        }, 80);
      });
    },
    ready(initial?: Size) {
      if (disposed) return;
      started = true;
      sent = initial;
      void send();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      view.clearTimeout(settled);
    },
  };
}
