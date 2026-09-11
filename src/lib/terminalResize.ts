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
) {
  let frame = 0;
  let started = false;
  let disposed = false;
  let sending = false;
  let desired: Size | undefined;
  let sent: Size | undefined;
  const send = async () => {
    if (disposed || !started || sending || !desired || same(desired, sent)) return;
    const size = desired;
    sending = true;
    try {
      await resize(size.cols, size.rows);
      sent = size;
    } catch (error) {
      console.error("Terminal resize failed:", error);
    } finally {
      sending = false;
      if (!same(desired, size)) void send();
    }
  };
  const fitNow = () => {
    if (disposed) return;
    const bounds = terminal.element?.parentElement?.getBoundingClientRect();
    // A hidden view has no meaningful geometry. FitAddon otherwise clamps
    // it to 2x1, which would make the CLI rewrite its transcript on return.
    if (!bounds?.width || !bounds.height) return;
    const size = fit.proposeDimensions();
    if (!size || size.cols < 2 || size.rows < 1) return;
    if (terminal.cols !== size.cols || terminal.rows !== size.rows) fit.fit();
    desired = { cols: terminal.cols, rows: terminal.rows };
    void send();
    return desired;
  };
  return {
    fitNow,
    requestFit() {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; fitNow(); });
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
    },
  };
}
