import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

type Size = { cols: number; rows: number; inputSession?: string };
const same = (a: Size | undefined, b: Size | undefined) =>
  !!a && !!b && a.cols === b.cols && a.rows === b.rows && a.inputSession === b.inputSession;

/** One owner for font, visibility and layout sizing. Native resize requests
 * are ordered and coalesced; unchanged geometry never reaches ConPTY. */
export function createTerminalResize(
  terminal: Terminal,
  fit: FitAddon,
  resize: (cols: number, rows: number, inputSession?: string) => Promise<void>,
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
  let sending: Promise<void> | undefined;
  let remote: Size | undefined;
  let desired: Size | undefined;
  let sent: Size | undefined;
  const send = async (): Promise<void> => {
    if (disposed || restoring || !started || (!remote && !isActive()) || !desired || same(desired, sent)) return;
    if (sending) { await sending; return send(); }
    const size = desired;
    const operation = size.inputSession ? resize(size.cols, size.rows, size.inputSession) : resize(size.cols, size.rows);
    sending = operation;
    try {
      await operation;
      sent = size;
      if (!disposed) terminal.refresh(0, terminal.rows - 1);
    } finally {
      sending = undefined;
    }
    if (!same(desired, size)) await send();
  };
  const sendLocal = () => { void send().catch(error => console.error('Terminal resize failed:', error)); };
  const fitNow = () => {
    if (disposed || restoring) return;
    // Inactive tiles are previews of a live terminal. Shrinking their PTY
    // makes native TUIs erase/replay history, only to repeat that work when
    // the user returns. Establish initial geometry, then fit active views.
    if (remote) return remote;
    if (started && !isActive()) return;
    const bounds = terminal.element?.parentElement?.getBoundingClientRect();
    // A hidden view has no meaningful geometry. FitAddon otherwise clamps
    // it to 2x1, which would make the CLI rewrite its transcript on return.
    if (!bounds?.width || !bounds.height) return;
    const size = fit.proposeDimensions();
    if (!size || size.cols < 2 || size.rows < 1) return;
    // Newly opened background tiles still need a usable logical terminal.
    if (!started && !isActive()) {
      size.cols = Math.max(80, size.cols); size.rows = Math.max(24, size.rows);
      terminal.resize(size.cols, size.rows);
    } else if (terminal.cols !== size.cols || terminal.rows !== size.rows) fit.fit();
    desired = { cols: terminal.cols, rows: terminal.rows };
    // Repaint even if the character grid stayed the same: moving a window,
    // revealing a clipped panel or finishing a CSS transition can invalidate
    // the renderer without changing cols/rows. This does not send input.
    terminal.refresh(0, terminal.rows - 1);
    sendLocal();
    return desired;
  };
  return {
    fitNow,
    async setRemoteSize(size: Size) {
      if (disposed || restoring || !started) throw new Error('Terminal is not ready to resize yet.');
      remote = size;
      if (terminal.cols !== size.cols || terminal.rows !== size.rows) terminal.resize(size.cols, size.rows);
      desired = size;
      await send();
    },
    releaseRemoteSize() { remote = undefined; fitNow(); },
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
      sendLocal();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      view.clearTimeout(settled);
    },
  };
}
