# Codex provider preview

Tessera can run Claude Code and Codex together. Codex is a separate coding-agent
provider in the existing new-session wizard; the OpenAI API chat option continues
to be a plain API chat. Existing workspaces with no provider field still use Claude.

## Using it

1. Open **Tessera Preview** and click **+**.
2. Choose **Chat** or **Terminal**, then **Codex · CLI login**.
3. Choose a model, reasoning effort, and project folder. Tessera discovers the
   models available to the installed CLI account instead of hardcoding a model list.
4. Keep **Project edits · ask for additional access** for workspace write access
   with human approval for additional permissions. Read-only and explicit full
   access are also available.
5. Click **Add Codex panel**, or browse existing Codex conversations and resume one.

Tessera uses the existing Codex CLI login and Codex conversation storage. It does
not copy authentication tokens, start a second login flow, or require an API key.
If detection fails, install the CLI, run `codex login` in a normal terminal, then
click **Retry**. An executable-path override is available for nonstandard installs.
This integration was exercised against `codex-cli 0.154.0` on Windows.

A **new terminal conversation takes its first message in Tessera**, then attaches
the native Codex TUI to that exact conversation. Codex creates its transcript only
after the first user turn; attempting to resume an empty thread fails. No artificial
bootstrap prompt is sent. Existing saved conversations attach immediately. Change
models and reasoning effort inside the native terminal once it is attached.

In chat, model and reasoning selections apply to the next turn. Markdown,
reasoning summaries, command output, file changes, tool calls, image attachments,
token usage, interruption, restart, and history are supported. **New** starts a fresh
conversation; **Restart** reconnects the current one. Empty unsent panels restore
as empty panels because they do not yet have a resumable transcript.

Approval and question cards belong to their own panel. Command/file approvals,
turn-scoped permission grants, questions, and basic MCP forms/URL elicitations are
supported. Unsupported server requests fail with a visible error. Complex MCP
forms that cannot be rendered can be declined or cancelled; they are never accepted
automatically. URL requests open only when the person clicks the displayed link.

## Claude and Codex collaboration

The existing `panels` MCP server exposes `list_panels`, `read_panel`, and
`send_to_panel` to both providers. For example:

> Ask the Codex panel named “Tests” to review the proposed changes and wait for its reply.

Codex delivery goes through the structured app-server turn API, including for a
terminal panel. This gives Tessera completion/interruption events and lets a hidden
group receive messages without relying on terminal keystrokes. Claude keeps its
existing chat and terminal delivery paths. A terminal Claude panel still has the
existing best-effort reply detection limitation.

Cross-panel messages are normal task input, never permission responses. Pending
Codex requests and active turns block additional delivery. Existing bearer-token
authentication, self-send prevention, rate limits, and hop limits remain in force.
Reply waits end on completion, interruption, process exit, pending user input, or
timeout. Enabled Tessera MCP servers are translated into per-panel Codex overrides;
global `~/.codex/config.toml` is not rewritten. Legacy SSE servers and unsupported
server names produce an explicit configuration error.

## Isolation and lifecycle

| Data or component | Stable | Preview |
| --- | --- | --- |
| Installed executable | `~/Apps/Tessera/Tessera.exe` | `~/Apps/Tessera-Preview/Tessera Preview.exe` |
| Desktop shortcut | Tessera | Tessera Preview |
| Tauri identifier / WebView storage | `com.tessera.app` | `com.tessera.preview` |
| Database, MCP files, runtime files | `~/.tessera` | `~/.tessera-preview` |
| Keyring service suffix | unchanged | `-preview` |
| Claude and Codex CLI accounts/history | existing CLI locations | same existing CLI locations |

The preview has its own Tessera workspace and settings. CLI accounts and history
are shared intentionally so existing conversations can be resumed. Do not continue
the same conversation concurrently in another app; Tessera prevents duplicate
threads within its own window and marks externally active history entries when
Codex reports that status.

Each Codex panel owns an app-server process. Chat uses stdio; terminal uses an
authenticated WebSocket on a random loopback port plus a ConPTY for the TUI.
The capability token is passed through an environment variable and a temporary
file, never placed in process arguments. Panel close, restart, workspace replacement,
and app exit tear down owned processes. Hiding a group keeps sessions alive.
Correlated RPC IDs, generation IDs, ordered events, and bounded replay logs prevent
cross-panel events and duplicate deltas. Ambiguous timed-out turns are not replayed.

Provider configuration and exact thread IDs persist through mixed workspaces and
groups. A restored legacy Claude workspace does not migrate into Codex. Duplicate
Codex IDs in malformed snapshots are not resumed twice.

## Build and test

```powershell
npm ci
npm test
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Stable

# Optional: uses the existing account for two tiny model turns, then resumes them.
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Live

npm run build:preview
powershell -ExecutionPolicy Bypass -File tools/promote-preview.ps1
```

For an opt-in live UI check, start only the preview with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, then run
`node tools/smoke-preview.mjs http://127.0.0.1:9222 C:\path\to\scratch-project`.
It verifies a chat turn, first-turn terminal attachment, and a second turn typed
through the native TUI on the same thread, then closes its own test panels.
Relaunch preview without the debugging environment variable afterward.

For the Windows GNU toolchain, put MSYS2 `mingw64/bin` and `usr/bin` on PATH for
`windres` and the linker. The Rust test helper embeds a common-controls manifest
in the generated test executable and supplies WebView2Loader.dll; Tauri normally
does this only for app executables.

Build the preview with **both** the preview Tauri configuration and Cargo feature,
as the `build:preview` script does. The configuration isolates WebView data and
app identity; the feature isolates the database and keyring. `promote-preview.ps1`
checks the binary identity and never stops or replaces stable Tessera. The stable
promotion script rejects preview binaries. No automatic updater, stable shortcut,
or `cgui` launcher is changed by preview installation.

The repository lives at `Desktop/Projects/tessera`; `claude_gui_v2` is a Windows
junction to the same folder for compatibility with existing paths. Work is on
`feature/codex-provider`; returning to the stable installed app requires no Git
operation. This branch has not been merged or published.

## Implementation map

- `src-tauri/src/codex/`: executable discovery, owned JSON-RPC transports, session
  lifecycle, model/history discovery, approvals, MCP configuration, terminal setup.
- `src/components/codex/`: provider setup, history browser, chat/terminal panel,
  approval/question cards and MCP forms.
- `src/lib/codexBridge.ts`, `codexReducer.ts`, and `src/store/codexStore.ts`: one
  app-level event listener with state hydration independent of component mounts.
- `workspaceSerializer.ts`, `panelCleanup.ts`, `usePty.ts`, and the panel bus:
  narrow provider-aware entry points around existing Claude behavior.
- `src-tauri/src/app_paths.rs`, the preview configuration and promotion scripts:
  preview state and installation separation.

Automated tests cover event isolation/correlation, stale generations, streaming
reconciliation, remounts beyond the replay window, approval resolution, mixed and
legacy workspace restoration, duplicate thread IDs, MCP translation and form
validation, permission constraints, and both state namespaces. The opt-in live
test covers stdio and authenticated WebSockets, real model output, exact-ID resume,
and process teardown.

On the development PC, the preview was also exercised through its actual WebView2
UI: CLI login and model discovery, chat output, MCP approval submission, history
restoration after app restart, new terminal attachment, a second native terminal
turn on the same thread, Claude-to-Codex and Codex-to-Claude reply waits, turn
interruption, and exact-thread restart. The stable installed executable's SHA-256
was checked before and after installation of the preview.

The repository still has dependency audit findings outside this provider change.
The added test tooling uses patched Vitest 3.2.7; production dependency upgrades
were kept out of this feature branch.
