import type { Terminal } from '@xterm/xterm';

/** Keep the last painted DOM frame during long Codex history replays.
 * xterm 6's one-second synchronized-output watchdog intentionally releases
 * its renderer. ConPTY can take longer to deliver a valid resume frame.
 * Preserve presentation only: parsing, CPR replies and input keep running.
 */
export function installTerminalFrameGuard(terminal: Terminal) {
  const element = terminal.element;
  const screen = element?.querySelector<HTMLElement>('.xterm-screen');
  if (!element || !screen?.querySelector('.xterm-rows')) return { dispose() {} };

  let active = false;
  let snapshot: HTMLElement | undefined;
  let status: HTMLElement | undefined;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const discard = () => {
    clearTimeout(showTimer);
    clearTimeout(expiryTimer);
    snapshot?.remove();
    status?.remove();
    snapshot = undefined;
    status = undefined;
  };
  const begin = () => {
    if (active) return;
    active = true;
    // A new frame can start before the previous one reaches the renderer.
    // In that case retain its already captured, last painted frame.
    if (snapshot) return;
    // Ordinary frames remain entirely xterm-owned. Cover only long frames,
    // before its 1000 ms watchdog exposes an incomplete transcript.
    showTimer = setTimeout(() => {
      if (!active) return;
      snapshot = screen.cloneNode(true) as HTMLElement;
      snapshot.classList.add('terminal-frame-snapshot');
      snapshot.setAttribute('aria-hidden', 'true');
      snapshot.inert = true;
      snapshot.querySelectorAll('.xterm-helpers, [id]').forEach(node => {
        if (node.classList.contains('xterm-helpers')) node.remove();
        else node.removeAttribute('id');
      });
      Object.assign(snapshot.style, {
        position: 'absolute', left: `${screen.offsetLeft}px`, top: `${screen.offsetTop}px`,
        pointerEvents: 'none', userSelect: 'none', zIndex: '5',
        background: terminal.options.theme?.background || '#1a1a2e',
      });
      element.append(snapshot);
      status = document.createElement('div');
      status.className = 'terminal-frame-status';
      status.setAttribute('role', 'status');
      status.textContent = 'Restoring view…';
      element.append(status);
    }, 800);
    // A malformed/missing end marker must never leave a frozen terminal.
    // User interaction also reveals live output immediately below.
    expiryTimer = setTimeout(discard, 30000);
  };
  const subscriptions = [
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
      if (params.includes(2026)) begin();
      return false;
    }),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
      if (params.includes(2026)) {
        active = false;
        clearTimeout(showTimer);
        if (!snapshot?.isConnected) discard();
      }
      return false;
    }),
    // Release only after xterm paints the completed frame, not while its
    // final PTY write is still being parsed.
    terminal.onRender(() => { if (!active) discard(); }),
    terminal.onResize(discard),
  ];
  const events = ['keydown', 'beforeinput', 'compositionstart', 'pointerdown', 'wheel'] as const;
  const interact = (event: Event) => {
    if (event.type === 'pointerdown' && snapshot?.isConnected) {
      // The visible link/text belongs to the held frame. Reveal live output
      // on this click without activating a different link underneath it.
      event.preventDefault();
      event.stopPropagation();
    }
    discard();
  };
  events.forEach(event => element.addEventListener(event, interact, true));
  return {
    dispose() {
      discard();
      subscriptions.forEach(subscription => subscription.dispose());
      events.forEach(event => element.removeEventListener(event, interact, true));
    },
  };
}
