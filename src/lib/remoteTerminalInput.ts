import type { IDisposable, Terminal } from '@xterm/xterm';

export interface RemoteInputTarget {
  deviceId: string;
  panelId: string;
  connectionId: string;
  inputSession: string;
}

const MAX_INPUT_BYTES = 64 * 1024;

/** One ordered, bounded queue per viewer. Failed or stale input is never retried. */
export class RemoteTerminalInput {
  private target: RemoteInputTarget | null = null;
  private queue: string[] = [];
  private bytes = 0;
  private generation = 0;
  private failed = false;
  private disposed = false;
  private draining = false;

  constructor(
    private send: (target: RemoteInputTarget, data: string) => Promise<unknown>,
    private onError: (message: string) => void,
    private onDelivered: () => void = () => {},
  ) {}

  get ready() { return !!this.target && !this.failed && !this.disposed; }
  get lease() { return this.generation; }

  setTarget(target: RemoteInputTarget | null) {
    if (JSON.stringify(target) === JSON.stringify(this.target)) return;
    this.generation++;
    this.target = target;
    this.queue = [];
    this.bytes = 0;
    this.failed = false;
  }

  enqueue(data: string) {
    if (!this.ready || !data) return;
    const bytes = new TextEncoder().encode(data).length;
    if (bytes > MAX_INPUT_BYTES || this.bytes + bytes > MAX_INPUT_BYTES || this.queue.length >= 1024) {
      this.fail('Terminal input is too large or the host is not keeping up.');
      return;
    }
    this.queue.push(data);
    this.bytes += bytes;
    void this.drain();
  }

  private fail(message: string) {
    this.failed = true;
    this.queue = [];
    this.bytes = 0;
    this.onError(`${message} Input stopped; check the host screen, then click Refresh to resume. Unsent keys were discarded.`);
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.ready && this.queue.length) {
        const data = this.queue.shift()!;
        this.bytes -= new TextEncoder().encode(data).length;
        const generation = this.generation;
        try {
          await this.send(this.target!, data);
          if (!this.disposed && generation === this.generation) this.onDelivered();
        } catch (error) {
          if (!this.disposed && generation === this.generation) this.fail(String(error));
        }
      }
    } finally { this.draining = false; }
  }

  dispose() {
    this.disposed = true;
    this.setTarget(null);
  }
}

/**
 * xterm's public onData also emits device-query replies and focus reports.
 * Only forward data marked as user input (keys, IME, paste, mouse) by xterm.
 * This small adapter targets the pinned xterm 6.0.0 internal event; fail
 * closed if it changes. Browser regression tests exercise both event paths.
 */
export function onTerminalUserData(term: Terminal, receive: (data: string) => void): IDisposable {
  const core = (term as unknown as {
    _core?: { coreService?: { onUserInput?: (listener: () => void) => IDisposable } };
  })._core?.coreService;
  if (typeof core?.onUserInput !== 'function') throw new Error('This terminal renderer does not support safe remote input.');
  let userInput = false;
  const user = core.onUserInput(() => { userInput = true; });
  const data = term.onData(value => {
    const forward = userInput;
    userInput = false;
    if (forward) receive(value);
  });
  return { dispose() { user.dispose(); data.dispose(); } };
}
