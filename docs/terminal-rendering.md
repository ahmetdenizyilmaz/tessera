# Terminal rendering and viewport ownership

Codex terminal panels could jump into earlier output when an approval appeared
or the user focused another panel and returned. The investigation covered the
native CLI, ConPTY output, xterm's parser/renderer, Mosaic sizing, approval layout,
scroll intent and component remounts. Claude uses the same `XTermView` integration.

## Findings

1. Tessera used xterm 5.5, which ignores DEC synchronized output mode (2026).
   A local capture from Codex 0.154.0 through Windows ConPTY contained 203 begin/end
   pairs in 921 chunks. A controlled browser comparison painted an intermediate
   frame with 5.5; xterm 6.0 painted zero intermediate frames and one completed
   frame. [xterm 6.0](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0)
   implements this protocol and replaces the browser-owned scroll viewport.
2. xterm had no `windowsPty` configuration. ConPTY grows the visible screen by
   appending rows; generic terminal behavior may pull rows out of scrollback.
   [The documented ConPTY options](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#windowspty)
   also use the actual Windows build to choose wrapping/reflow behavior.
3. Font updates, visibility changes, initial mount, remount and ResizeObserver
   each had separate fit/resize paths. The backend accepted unchanged geometry.
   Approval cards occupied the same flex column as the terminal, so merely
   receiving or expanding a request changed the PTY's row count. Codex can clear
   and replay its transcript on width changes and height growth, as its
   [transcript reflow implementation](https://github.com/openai/codex/blob/main/codex-rs/tui/src/transcript_reflow.rs)
   and [Windows resize report](https://github.com/openai/codex/issues/38839) describe.
4. The previous scroll guard treated every pointer-down as a scrollbar drag.
   A focus click held during a resize/viewport reset could therefore record the
   top as the user's chosen reading position. It also reapplied scroll position
   after every parsed output batch. Saved terminal content was replayed at the
   default width on remount, even if it had been serialized from a narrow panel.
5. A follow-up report still reproduced old output appearing on a panel switch.
   The mosaic deliberately shrinks inactive tiles and enlarges the selected one;
   fitting every tile therefore still resized the native terminal twice per round
   trip. A real Codex/ConPTY run with a long test conversation and five mosaic
   panels exposed the transcript replay even while `viewportY === baseY`.
   Checking only the final scroll position missed this visible failure.
6. Verification in the restored user workspace exposed a second sizing trigger:
   the empty mosaic root had no container ref. Its mount-only measurement effect
   therefore returned before autosave loaded the panels, leaving container size
   at zero. Panel contents fell back to `100%` and followed every intermediate
   animation size instead of using final pixel dimensions. Eight switches sent
   95 terminal resizes. The empty and populated states now share the measured root;
   the regression test starts empty before restoring five panels.
   The corrected Preview was then checked in that same restored workspace:
   eight switches produced zero terminal resizes, zero transcript erases and
   zero transcript render frames, with the viewport at the bottom throughout.
   All five conversation identities and the Codex Full access policy survived.
7. Cursor protection originally depended on Codex's `busy` flag, so it stopped
   after an interruption even while the user edited the next draft. Idle Codex
   composers now receive the same display-only protection when a model/shortcut
   footer identifies the input. Pending requests, slash menus and numbered
   selections retain the native cursor. This covers the brief visible cursor
   above the draft described in the
   [upstream Windows cursor report](https://github.com/openai/codex/issues/39710).
   A real-xterm regression reproduces the interrupted-input frame and checks
   middle/multiline editing, recovery and menu exclusions. An isolated native
   Codex/ConPTY typing run also preserved the input caret, but did not reproduce
   the intermittent upstream flash; verification in the user's running app is
   still needed after installing this change.

## Ownership

- **Native rendering:** pinned stable xterm 6.0 and matching addons execute all
  PTY bytes, own ordinary following/scrolling and paint synchronized frames.
  The existing display caret also waits for a completed frame. No escape bytes
  are rewritten and cursor-position reports still describe the real terminal.
- **Platform:** `pty_capabilities` reports ConPTY plus the host build using
  `sysinfo::System::kernel_version()`. Non-Windows hosts receive no Windows options.
  `terminalPlatform.ts` caches one result per window. There is no machine-specific
  build number in application code.
- **Geometry:** `terminalResize.ts` is the single sizing coordinator. It coalesces
  layout observations per animation frame, rejects hidden/zero-sized layouts,
  serializes native resize calls and retains only the latest pending size.
  It waits for PTY startup and skips unchanged dimensions. The backend caches
  successful geometry too, including across view remounts. The data listener is
  registered before spawning the CLI; disposed views reject late callbacks.
  After initial sizing, inactive terminal tiles retain their working geometry and
  show a clipped preview. Their headers keep the normal tile layout. Reactivating
  a terminal requests a fit; when its active size is unchanged, no resize reaches
  the CLI. Window/font/layout changes still fit the active terminal, and inactive
  terminals pick up the new geometry when selected. This shared behavior applies
  to Claude and Codex. A first activation at a new size can still require reflow.
- **Viewport intent:** `terminalScroll.ts` observes actual wheel, scrollbar,
  selection-drag and scroll-key gestures. Focus clicks do not change intent.
  Position is restored only across resize, transcript erase/replay or remount,
  after synchronized output completes. Reading anchors are matched when present;
  otherwise the previous row is clamped to available history. Ordinary output
  never triggers a forced scroll. Typing, editing, paste and IME reveal the input;
  output-driven terminal replies do not.
- **Remounts:** serialization retains the original rows/columns alongside the
  scroll state so history is reconstructed at the correct width before fitting
  the destination view. Explicit restart still starts with a fresh terminal.
- **Requests:** native Codex approvals/questions occupy a top drawer over the
  terminal, preserving the PTY's dimensions. The normal drawer leaves the input
  below it visible; Alt+Up expands it, Escape/Alt+Down return focus to the input.
  Existing Claude-style forms, answer drafts and approval responses are retained.
  Chat view retains its normal request layout.

The erase/replay boundary handling is still needed with stable xterm 6.0:
[upstream PR #6081](https://github.com/xtermjs/xterm.js/pull/6081) fixes a remaining
ED3/user-scroll interaction after that release. Tessera uses public APIs to
restore intent at this boundary. It does not ship an xterm fork or use private
scroll state. Real Codex/ConPTY captures also contain cursor moves outside
synchronized blocks, so the renderer upgrade alone is not a claim that every
upstream redraw artifact is eliminated.

## Verification

```powershell
npm test
npm run build
node tools/test-terminal-scroll.mjs
node tools/test-terminal-cursor.mjs
node tools/test-terminal-protocol.mjs
# With npm run dev running:
node tools/test-panel-ui.mjs
node tools/test-panel-switch.mjs
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1
npm run build:preview
```

The protocol test imports the actual Vite/Rollup/minified xterm production chunk:
mode queries, CPR, split synchronized frames, ConPTY row growth, alternate screens,
wide characters, reflow, resize ordering, hidden views and disposal. The browser
tests use real xterm and actual React components with isolated mocked Tauri IPC.
They cover focus clicks during redraw, deliberate history reading, chunked replay,
typing/paste/IME, narrow-view unmount/remount, repeated visibility changes and
approval arrival/expansion/collapse/dismissal without a single native resize.
They run no model turns and do not touch saved user sessions.

The panel-switch test mounts the actual five-panel mosaic with real xterm. It
checks that switching away and back preserves geometry, input following and
intentional history reading without native resize calls, while actual window
resizing still works. A separate live test resumed an owned Codex test thread
through ConPTY: eight switches caused eight resizes and visible replay before
the change, and zero resizes or replay afterward. User conversations were not
used or modified by that test. This verifies removal of the repeated-switch
trigger, not every upstream redraw behavior during a necessary resize.
