# Claude GUI v2 — Audit & Fixes (2026-08-18)

Three scan agents (Rust backend, frontend state, cross-boundary flows) audited
the app; every load-bearing finding was verified in the code before fixing. All
items below are **fixed and applied** unless marked otherwise. Two CLI facts
were confirmed empirically (see end).

## Critical

- **C1 — session-path encoder disagreed with the CLI on non-ASCII paths.**
  `encode_project_path` used Rust `char::is_alphanumeric()` (Unicode), which
  keeps Turkish `ı`; the CLI uses `[^a-zA-Z0-9]→-`. On this machine
  `Desktop\Belgeler` is on disk as `...Desktop-Belgeler`. Result: chat
  panels in such folders started fresh every restart; terminal panels
  hard-errored at spawn. **Fix:** ASCII-only encoder + strip trailing slashes
  in `resolve_work_dir`. (`claude_paths.rs`) The CLI's >200-char hash-truncation
  is *not* reproduced — only the ≤200 case is guaranteed to match; longer paths
  were already unsupported.

- **C2 — deleting a group at the panel limit destroyed its panels.** Re-adopted
  children were added via `addPanel`, which refuses over 12; the orphan purge
  then deleted them permanently. **Fix:** `addPanel(id, type, force=true)` for
  re-adoption. (`layoutStore.ts`, `groupStore.ts`)

## Major — recent regressions

- **M1 — maximize left a blank workspace.** `restoreLayout` never cleared
  `maximizedId`, so any group enter/exit or workspace load with a panel
  maximized hid every tile. **Fix:** clear `maximizedId` in `restoreLayout` and
  `addPanel`. (`layoutStore.ts`)
- **M2 — Ctrl+Tab broke while maximized.** `cycleFocus` bypassed the
  maximize-swap. **Fix:** route through `setActiveTab`. (`layoutStore.ts`)
- **M3 — loading a workspace never cleared the current one** (orphans, merged
  groups, zombie CLIs). **Fix:** `deserializeWorkspace` kills processes and
  clears stores first when a workspace is already open. (`workspaceSerializer.ts`)
- **M4 — LLM panels lost their transcript every restart** (persisted by
  instance id, never remapped). **Fix:** `remapConversations(idMap, liveIds)`
  re-keys and GCs. (`llmChatStore.ts`, `workspaceSerializer.ts`)
- **M5 — `/clear` then Switch-session showed an empty transcript** (stale
  `clearedRef`). **Fix:** reset the guard when the session id changes.
  (`ChatView.tsx`)
- **M6 — "Start fresh" on a terminal resurrected old scrollback** (buffer
  deleted before the old view re-saved it). **Fix:** mark the id and clear on
  next mount instead. (`usePty.ts`, `XTermView.tsx`)

## Major — panel bus

- **P1 — roster only saw the current nav level.** Grouped/root panels vanished
  from `list_panels`. **Fix:** roster = tabOrder ∪ all group childIds, minus
  non-Claude types. (`panelBus.ts`)
- **P2 — `wait_for_reply` could return the wrong turn's answer.** No turn
  correlation. **Fix:** per-watcher countdown of in-flight turns
  (`pending_turns`), so a waiter resolves only on its own turn's result.
  (`stream/manager.rs`)
- **P3 — `stream_clear` stranded waiters** (watchers never released). **Fix:**
  `teardown_process` releases them with `ProcessDied`. (`stream/manager.rs`)
- **P4 — the hop limit bricked a panel from sending.** Per-panel hop never
  reset. **Fix:** decay after 120 s so a fresh send starts at hop 1 while loops
  (ms-fast) are still caught. (`panelbus/mod.rs`)
- **P5 — identity was defeatable** (one shared token, id in URL). **Fix:**
  per-panel tokens; the server checks the bearer matches the path's id. Config
  files are deleted on close. *Residual (inherent):* a model with filesystem
  access under the same OS user can still read another panel's config file —
  documented, not fully closable without per-user isolation.
- **P6 — cross-panel messages showed a reply with no question; Computer panels
  were reachable.** **Fix:** `__panelInject` seeds history + adds the user turn
  for never-mounted panels; non-Claude panels excluded from the roster.
  (`panelBus.ts`)

## Minor

- **8.2** dedupe/`openSessionIds` now count panels inside groups, so "Open"
  can't spawn a second process on one session file. (`openSession.ts`)
- **8.3** Session History records all real panels (incl. grouped), only when a
  session id exists — no more id-less junk rows per close. (`useAutoSave.ts`)
- **8.4** "Move to → Main" uses `movePanelToLevel` instead of the no-op path.
  (`TabContextMenu.tsx`)
- **7.1** Ctrl+Tab no longer fires while a dialog is open. **7.3** Escape now
  covers the Attach, Usage, and Switch-session dialogs. (`App.tsx`,
  `SwitchSessionDialog.tsx`)
- **Leaks:** panel-bus hop/rate/token maps pruned and config file deleted on
  `stream_kill`/`pty_kill`; chat transcripts destroyed on panel close.
  (`panelbus/mod.rs`, `stream/manager.rs`, `pty/manager.rs`, `panelCleanup.ts`)
- **mcp_check_status / temperature / LLM restart / seed-history** — already
  fixed in the prior "polish" pass (commit `e97cc38`).

## Not fixed (with reason)

- **F-8 — `deliver_to_terminal` types into whatever the TUI shows** (incl. a
  permission dialog). There's no reliable way to read TUI state from outside;
  injected text is at least visibly prefixed. Left as a known limitation.
- **C1 >200-char path hashing** — the CLI's exact hash isn't reproduced; only
  the common non-ASCII case is fixed.
- **P5 same-user file isolation** — inherent to all panels running as one OS
  user with filesystem access.

## Verified against the CLI (2.1.234), not assumed

- Repeated `--mcp-config` flags **accumulate** (init event lists both servers) —
  our two-flag spawn is correct.
- `--allowedTools mcp__panels` (bare server prefix) covers all of that server's
  tools — correct.
- `auto` / `manual` are real `--permission-mode` values — the new default is
  fine (an agent's "possibly invalid" flag was a false alarm).

## False alarm retracted

- Permission mode `auto` was flagged as possibly rejected by the CLI; it is a
  documented mode. No change needed.
