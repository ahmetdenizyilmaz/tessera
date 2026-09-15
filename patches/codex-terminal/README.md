# Codex terminal history I/O

Tessera uses the official installed Codex app-server and attaches a native terminal
client over an authenticated local WebSocket. On Windows, Codex 0.154.0 writes
restored scrollback through line-buffered stdout. Newlines and subsequent formatting
commands cause many small console writes during a large history insertion.

`buffer-history.patch` adds a bounded 64 KiB writer around history insertion and
explicitly flushes before returning. Every original escape sequence and history
line is retained in order, including hyperlink metadata and the final cursor
restore. The patch does not change scrollback limits, conversation data, rendering
styles, permissions, or input. It does not cover the terminal with a snapshot.

The source is OpenAI Codex tag `rust-v0.154.0`, commit
`6b9826e3aa83b1a5947db50f4332cb9c65f1b340`, licensed under Apache 2.0.
The source modification is included here so no private repository or MCP service
is needed to reproduce it.

## Build

Install Rust 1.95.0 and the compiler/linker for your Windows target. For MinGW,
the script supports the existing MSYS2 installation at `C:\msys64`.

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-codex-terminal.ps1
npm run build:preview
```

`-SourceDirectory` can reuse a checkout of the exact pinned source. The release
tag's workspace-version entries need reconciliation in Cargo.lock; dependencies
remain pinned. The generated executable and provenance manifest are build outputs,
excluded from Git. Tauri packages the `codex-terminal` resource directory, including
the upstream license and notice.
The GNU build also packages MSYS2's `liblzma-5.dll` and its 0BSD license, so the
installed renderer does not require MSYS2 on the user's PATH.

Only the terminal attachment uses this executable. Discovery, history operations,
the app-server, tools, approvals, and model execution use the installed official
CLI. Explicit per-panel executable overrides take precedence. If the bundled
renderer is absent, invalid, or a different version from the installed CLI,
Tessera falls back to the official renderer. Updating the installed CLI can
therefore require refreshing this patch to retain the performance improvement.

## Validation

The patch includes checks that all 2,500 history rows are written in order, console
writes are batched, the cursor is restored, and buffered write errors propagate.
Existing upstream terminal snapshots exercise styling, wrapping and hyperlinks.
Run the upstream tests with `just test -p codex-tui` in the patched checkout.

Native verification must resume an isolated test thread with the official
app-server and the patched terminal client, retain the complete scrollback, and
check input and full-transcript navigation. A smaller standalone console benchmark
is supporting evidence only; it does not establish end-to-end startup time.

Local checks on Windows (2026-09-15):

- Tessera Rust tests: 28 passed; 3 optional live tests ignored. The renderer's
  optional live version-match/fallback test was then run separately and passed.
- Codex TUI tests: 4,234 passed, 35 failed, 6 skipped. All 20 history-insertion
  tests passed, including both new buffering tests and existing wrapping/link tests.
  All 35 failures were reproduced with the history patch removed. They include
  release-version snapshots and Windows path/cursor expectations; their snapshots
  were not updated or accepted.
- Scoped Rust formatting passed. Workspace `just fmt` could not complete on this
  Windows setup because of the command-length limit and missing Bazel formatter
  launcher; the patch changes only the two Rust files included here.
- Native ConPTY/xterm verification used the official app-server, an isolated
  test conversation and 2,500 numbered display lines (5,054 terminal rows).
  The saved rollout was not expanded. Both clients used the test-only setting
  `tui.terminal_resize_reflow_max_rows=0`; no user configuration was changed.
  Unmodified history delivery took 11.85 seconds (11.50 seconds in a repeat with
  the heavy builds finished). The patched client delivered those same rows in
  0.186 seconds. Its first history frame was already at the transcript tail;
  all 2,500 lines remained in terminal scrollback. Typing and transcript
  Home/End navigation passed. The default-configuration smoke test also passed.
- The complete terminal output span, which includes startup and subsequent
  notices, decreased from 13.74 seconds (12.16 seconds in the idle repeat) to
  1.84 seconds. These are local fixture measurements, not a guarantee for
  every conversation size or machine.
