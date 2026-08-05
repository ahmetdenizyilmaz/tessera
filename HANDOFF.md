# Claude GUI v2 — Handoff / Current State

Last updated: 2026-07-29. Written so another Claude session can continue without re-deriving anything.

---

## 1. What this is, and where

A Tauri 2 desktop app (React 19 + zustand frontend, Rust backend) that hosts **multiple Claude Code sessions** in a tiling "mosaic" layout.

- **Active codebase: `C:\Users\user\Desktop\claude_gui_v2`** — this is the only one to edit.
- `claude_gui_stable` and `claude_gui` on the Desktop are older copies. Ignore them. (A session's working directory is often `claude_gui_stable` — don't be fooled.)
- Git: private repo `https://github.com/ahmetdenizyilmaz/claude-gui-v2`, branch `master`.

## 2. Build & run (exact, Windows)

The Rust build needs the msys64 linker, or it fails:

```powershell
$env:PATH = "C:\Program Files\nodejs;C:\Users\user\.cargo\bin;C:\msys64\mingw64\bin;C:\msys64\usr\bin;" + $env:PATH
$env:RUSTFLAGS = "-C linker=C:/msys64/mingw64/bin/gcc.exe -C link-arg=-fuse-ld=lld"
Set-Location "C:\Users\user\Desktop\claude_gui_v2"
npx tauri dev      # dev; npx tauri build for the NSIS installer
```

- Release installer lands in `src-tauri\target\release\bundle\nsis\`.
- Ports 1420/1421 must be free — a stale vite server is the usual "port already in use" cause; kill the PID holding them.
- Frontend edits hot-reload. **Rust edits restart the app** (~30 s), which wipes in-app chat panels.
- Verify with `npx tsc --noEmit` and `cargo check` (in `src-tauri`) before committing. Both are currently clean.

## 3. Architecture: two INDEPENDENT pipelines

This is the single most important thing to understand. A panel is **either** a chat panel **or** a terminal panel — chosen at creation (`InstanceConfig.panelView`) and fixed for its lifetime. They are separate Claude sessions and never shared a conversation. (An earlier Chat|Terminal toggle implied otherwise and was removed.)

### Chat pipeline — `src-tauri/src/stream/manager.rs`
One **long-lived** `claude` process per instance, spawned lazily on first send:

```
claude -p --verbose --input-format stream-json --output-format stream-json
       --include-partial-messages --permission-prompt-tool stdio
       [--resume <sid>] [--model M] [--append-system-prompt S]
       [--permission-mode M] [--allowedTools T] [--mcp-config P]
       [--dangerously-skip-permissions]
```

- User turns are written to the child's **stdin as JSONL**; output lines are batched (16 ms / 64 lines) and pushed into the webview via `window.__streamPushBatch` (Tauri's emit/listen does NOT reach WebView2 — hence `eval`).
- Reader threads are **generation-tagged**; a stale generation stops pumping. `/clear` and kill bump the generation.
- Commands: `stream_configure` (idempotent, no spawn), `stream_send_message`, `stream_control_response`, `stream_control_request`, `stream_clear`, `stream_kill`, `stream_set_model`, `stream_set_thinking`.

### Terminal pipeline — `src-tauri/src/pty/manager.rs`
A real ConPTY running the interactive Claude Code TUI, rendered by xterm.js. Spawns lazily when a terminal panel mounts. Output is coalesced (5 ms / 64 KB) before hitting the IPC.

## 4. Verified CLI facts (probed against `claude` 2.1.220 — do not re-guess)

- `--thinking-budget-tokens` and `--max-turns-budget` **do not exist**. Using them makes the process exit instantly. Thinking budget goes through the control protocol (`set_max_thinking_tokens`); the real budget flag is `--max-budget-usd` (print mode only).
- **`--permission-prompt-tool stdio` must ALWAYS be passed** — including alongside `--dangerously-skip-permissions`. Without it the CLI does not inject the `AskUserQuestion` tool at all (the model reports "no such tool"). With both, permissions stay bypassed while questions still arrive as control requests. This was verified by direct probe; it is not obvious and cost real debugging time.
- Control protocol over the same pipes:
  - CLI → app: `{"type":"control_request","request_id":R,"request":{"subtype":"can_use_tool","tool_name",...}}`
  - app → CLI: `{"type":"control_response","response":{"subtype":"success","request_id":R,"response":{"behavior":"allow"|"deny","updatedInput"?,...}}}`
  - App-initiated subtypes: `initialize`, `interrupt`, `set_model`, `set_permission_mode`, `set_max_thinking_tokens`.
- `AskUserQuestion` is answered via the can_use_tool response with `updatedInput.answers = { "<question text>": "<label>" }` (multi-select = comma-joined). `ExitPlanMode` likewise (allow = plan approved).
- `--include-partial-messages` wraps deltas as `{"type":"stream_event","event":{...}}` — the bridge unwraps them.
- Session transcripts live in `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Lines use `"type":"user"` / `"assistant"` (there is no `"human"`). `isMeta` / `isSidechain` lines and `<command-name>` / `<local-command-stdout>` wrappers are CLI plumbing and must be filtered out.
- `--resume <id>` **errors and exits** if the session file is missing — it does not fall back. Always guard on file existence (`claude_paths::session_file_path(...).exists()`).
- Child processes must not inherit `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_EXE` — otherwise the child thinks it is nested and disables transcript saving (or refuses to start).
- Windows kill must be a **tree kill** (`taskkill /PID <pid> /T /F`) — `child.kill()` on a `claude.cmd` shim orphans the real node.exe.

## 5. Key frontend files

| File | Role |
|---|---|
| `src/lib/streamAccumulator.ts` | Builds the message list. **Copy-on-write**: every mutation clones the touched message and replaces the array, so `React.memo` identity compare works. |
| `src/store/chatStore.ts` | Per-instance session state, `controlRequests` queue, tool-result linking, system notes. |
| `src/lib/streamBridge.ts` | `window.__streamPushBatch` / `__streamExit` / `__streamError`; unwraps `stream_event`; classifies stderr fatal vs warning. |
| `src/components/chat/ChatView.tsx` | Panel chat UI, `/clear`, transcript restore, session-id capture. |
| `src/components/chat/ControlRequestArea.tsx` | Permission card, AskUserQuestion card, plan-approval card. |
| `src/lib/workspaceSerializer.ts` | THE persistence path (`claude-gui-autosave`, v3 snapshot). One idMap remaps instances + layout + group childIds + plugin panels. `restoreOnce()` guard. |
| `src/store/layoutStore.ts` | Mosaic geometry. `stealFraction` is **per-axis `{x,y}`**. |
| `src/components/terminal/TerminalPanel.tsx` | Panel shell: toolbar, ☰ compact menu, renders chat OR xterm by `panelView`. |

## 6. Hard constraints (agreed with the user — do not violate)

1. **Never change how panel resizing feels for 1–5 panels.** The drag-time path (pointer math → `setRawPanelRects`, and `finishResize` storing only the fraction) must stay untouched. 6+ panels use the newer `grid` layout.
2. **`panelView` is fixed at creation.** Do not add a Chat/Terminal toggle back to the panel toolbar.
3. Toolbar crowding is solved by **one** hamburger threshold (`COMPACT_TOOLBAR_WIDTH = 430`), not per-element breakpoints.

## 7. What was done (22 commits: baseline, Phases 0–10, then live-testing fixes)

Condensed; `git log` has the detail.

- **Chat correctness**: tool results (`type:"user"` events) were being dropped entirely — every tool widget hung on "Running…". Fixed, plus copy-on-write accumulator (auto-scroll and message grouping were frozen after the first turn), same-id assistant merging (duplicate React keys), failed turns surfaced, stderr classified.
- **Architecture**: replaced per-message one-shot spawns with the persistent process + control protocol. This is what made interactive prompts possible at all.
- **Interactive prompts**: permission cards, AskUserQuestion with clickable options, plan approval. Answers record back into the transcript (the CLI never echoes `updatedInput`).
- **Process lifecycle**: PTY child handle stored + tree-kill; `kill_all` on app exit; `--resume` guarded everywhere; truthful status badges.
- **Persistence**: one `workspaceSerializer` replaced three inconsistent schemes; groups/widgets/plugins/active tab now survive restarts; transcripts restore from session files.
- **Startup**: window starts hidden + dark, shown after first paint (was a white flash); startup chunk 2.6 MB → 992 kB via lazy pixi/recharts.
- **Perf**: lazy PTY spawn (chat-only tabs cost no process), event coalescing, resize debounce, serialized writes.
- **Layout**: per-axis resize fractions, tab reorder no longer destroys snaps, grid layout for 6+, tab overflow menu, double-click rename.

## 8. State: verified vs NOT verified

**Verified working (seen live):** chat replies with tool widgets, token streaming, AskUserQuestion card end-to-end, question Q&A record, hamburger collapse, tab overflow, startup with no white flash, workspace restore of panels/directories.

**Implemented + compiling but NOT yet exercised: see `TESTING.md`.** That file is the
living checklist (zombie cleanup on a clean X close, permission cards with Skip
Permissions off, plan approval, image paste, `/clear` amnesia, transcript restore,
attach-external-session, the Claude API provider, panel messaging). Keep it there
rather than duplicating the list here, where it drifts.

## 9. Known gaps / candidate next steps

1. **Session History dialog can't reopen anything** — it is only a local log (search/favorite/delete) from `sessionStore`. Reopening lives in **File → Resume Session** (backed by `session_list_recent`). Adding an "Open" button to Session History was offered and not yet done.
2. **Restored transcripts are plain text** — the session JSONL gives text only, so old tool widgets/thinking blocks/question cards come back as conversation text. New messages render fully.
3. **MCP config is never passed to either pipeline** (`mcp_config_path` is plumbed but the frontend never sends it) — servers configured in McpManager are inert; only user-global `~/.claude.json` servers load. *Being fixed as part of panel messaging (Phase 2).*
4. No multi-OS-window support (single window by design so far).
5. `mcp_check_status` is invoked by `McpServerCard.tsx` but **does not exist in Rust** — the Test Connection button always reports disconnected.
6. The `mcp_servers` table seeds a `desktop-control` row pointing at `mcp_server.py`, which is not shipped in this repo. Disabled by default, but it should go.
7. The temperature slider shows for the Claude (API) provider but does nothing — current Claude models reject `temperature`.

## 10. Conventions

- One commit per logical fix, imperative subject, body explaining **why** (the bug), trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Commit and push as work lands; the user asks for pushes explicitly.
- The user tests in the live app and reports UX issues in short messages — expect rapid small iterations, often with screenshots.
