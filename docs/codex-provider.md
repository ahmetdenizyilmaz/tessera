# Codex provider preview

Tessera can run Claude Code and Codex together. Codex is a separate coding-agent
provider in the existing new-session wizard; the OpenAI API chat option continues
to be a plain API chat. Existing workspaces with no provider field still use Claude.

## Using it

1. Open **Tessera Preview** and click **+**.
2. Choose **Chat** or **Terminal**, then **Codex · CLI login**.
3. Choose a model, reasoning effort, and project folder. Tessera discovers the
   models available to the installed CLI account instead of hardcoding a model list.
4. Choose permissions, or keep your saved default. **Auto-review** lets Codex
   review requests for additional access automatically. **Project edits** asks
   you for those approvals; read-only and explicit full access are also available.
5. Click **Add Codex panel**, or browse existing Codex conversations and resume one.

Tessera uses the existing Codex CLI login and Codex conversation storage. It does
not copy authentication tokens, start a second login flow, or require an API key.
If detection fails, install the CLI, run `codex login` in a normal terminal, then
click **Retry**. An executable-path override is available for nonstandard installs.
The empty-terminal startup/resume path was exercised against both
`codex-cli 0.154.0` (bundled renderer) and `0.155.1` (installed CLI) on Windows.

Set **Settings → General → Default Codex permissions** to choose the starting
mode for new chat and terminal panels. **Auto-review · automatic approval reviews**
uses a workspace sandbox with `approvalPolicy: on-request` and
`approvalsReviewer: auto_review`. A denied request can still require your input.
**Full access · no approval prompts** uses `danger-full-access` with `never`,
allowing file changes outside the project and network commands without asking.
See the [official approval documentation](https://learn.chatgpt.com/docs/agent-approvals-security).

Existing panels retain their saved policy, including older workspaces that used
human approvals. Open a panel's **Panel controls → Codex permissions** to change
it while idle. This reconnects the same conversation and saves the selected mode;
finish or cancel a pending turn first. Claude permission defaults are separate.
Tessera passes these choices to Codex and does not automatically click approval cards.

Native `/permissions` changes are synchronized back to the panel's saved policy
through Codex's `thread/settings/updated` notifications, including replay after a
group remount. Changing permissions does not resolve an approval already pending
in an active turn. Finish or cancel that request before reconnecting the panel.

The app-server connection opts into `experimentalApi` because Codex 0.154.0 gates
these settings notifications behind that capability. Previously the native menu
changed to Full Access while Tessera received no event and saved the old
Ask-for-approval policy; restarting restored that older policy. Two subscribed
connections to the same live server reproduced the difference: the stable-only
connection received no policy events, while the opted-in connection received both
native changes. See [API capability negotiation](https://learn.chatgpt.com/docs/app-server#experimental-api-opt-in).
Attestation remains disabled and unsupported server requests retain their
existing handling; capability negotiation does not automatically grant approvals.

The start/resume response now supplies the effective policy, and snapshots retain
the latest sequenced settings event independently of the 4096-event replay log.
Hydration preserves newer native restrictions and ignores another thread's policy.
The global permission default still applies to new panels; existing panels keep
their own explicitly selected mode.

Run `powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Permissions`
to exercise the real native settings RPC and notifications over both stdio and
authenticated WebSockets. This creates only ephemeral test threads, verifies
Full access, Auto-review and Read only, and runs no model turns.

The rebuilt Preview was also verified against Codex 0.154.0 through its real
WebView2 UI: selecting Full Access in the native menu updated the saved panel,
and a full application restart retained `never` / `dangerFullAccess` on the same
conversation ID. A disposable terminal inherited the Full access default, then
executed a native terminal turn that wrote a file outside its project and called
`panels.list_panels`; both completed with zero approval requests. The test panel
was closed afterward and the five existing user panels were preserved.

Pending Codex questions and approvals are also shown as GUI cards using Claude's
question/option styling. Press **Alt+Up** inside a Codex panel to expand and focus
its requests; **Alt+Down** or **Escape** returns to the input. The shortcut does
not send a terminal key or approve anything, and answer drafts survive collapsing
the request area.

Terminal viewports follow new output while at the bottom. Deliberate scrolling
keeps a text anchor through transcript redraws and panel/group remounts; browser
scroll resets do not disable following. This does not filter or rewrite the
native terminal's output, and alternate-screen menus keep their native behavior.
Typing, editing, IME composition, or pasting ends history browsing and reveals
the input again in both Claude and Codex terminals. Automatic terminal replies
and history-scrolling shortcuts leave the reading position intact.

A **new terminal conversation opens directly in the native Codex TUI**, without
a first message in Tessera's chat composer. For fresh terminals only, Tessera
selects legacy history and calls Codex's official `thread/name/set` API to persist
the empty conversation metadata. It verifies that the same thread can be read,
then attaches the TUI to that exact ID. No artificial bootstrap prompt is sent,
and Tessera does not write Codex's private history format for this startup path.
Existing saved conversations keep their normal resume path. Change models and
reasoning effort inside the native terminal once it is attached.

Both providers share the same compact header, color chooser, rename behavior,
and restart/maximize/close icons. Click the color dot (or right-click the title)
to choose a color; double-click the name to rename. Model and effort appear in
small text under the title. Chat model/effort controls live in **Panel controls**
(the menu icon), along with Claude checkpoints or Codex token usage. The native
Codex terminal also displays its current model/effort in its own footer.

In chat, model and reasoning selections apply to the next turn. Markdown,
reasoning summaries, command output, file changes, tool calls, image attachments,
token usage, interruption, restart, and history are supported. Use the main **+**
wizard for new conversations and history; the panel has no **New** or **History**
buttons. **Restart** reconnects the current conversation. Empty terminal panels
retain their exact ID through restart and workspace save/restore; empty chats
without a saved transcript still reopen as fresh empty chats.

The paperclip in both chat composers opens the native Windows image picker.
PNG, JPEG, GIF and WebP files up to 10 MB each are supported, with up to eight
picker attachments. Image previews can be inspected or removed, and image-only
messages can be sent. Codex also accepts pasted images; Claude keeps its existing
paste, file-mention, slash-command and message-queue behavior. Claude copies picked
images to the project's `.tessera-images`, like its pasted images, so queued turns
retain the attachment even if the original file is removed. File-picker cancellation
does nothing; loading errors are shown in the composer.

Approval and question cards belong to their own panel. Command/file approvals,
turn-scoped permission grants, questions, and basic MCP forms/URL elicitations are
supported. Unsupported server requests fail with a visible error. Complex MCP
forms that cannot be rendered can be declined or cancelled; they are never accepted
automatically. URL requests open only when the person clicks the displayed link.

## Claude and Codex collaboration

The existing `panels` MCP server exposes `list_panels`, `read_panel`, and
`send_to_panel` to both providers. For example:

> Ask the Codex panel named “Tests” to review the proposed changes and wait for its reply.

The MCP tool descriptions, server instructions, Codex developer instructions, and
bundled Claude skill all define **panel, session, subwindow, sub-window, pane, tab,
chat, conversation, and other agent** as the same open destination. For example,
“send the other session this message” and “ask the backend subwindow” should use
`list_panels` then `send_to_panel`. A single matching non-self destination can be
selected directly; several ambiguous matches require clarification. Closed history
and unrelated OS windows are outside this roster. Messaging remains subject to
the existing approval and delivery rules. Restart an existing panel to reload its
MCP descriptions after an app update.

Codex delivery goes through the structured app-server turn API, including for a
terminal panel. This gives Tessera completion/interruption events and lets a hidden
group receive messages without relying on terminal keystrokes. Claude keeps its
existing chat and terminal delivery paths. A terminal Claude panel still has the
existing best-effort reply detection limitation.

Cross-panel messages are normal task input, never permission responses. Pending
Codex requests and active turns block additional delivery. Existing bearer-token
authentication and self-send prevention remain in force. Authorized panel
conversations have no fixed hop or messages-per-minute cutoff. Agents are told
to send replies back explicitly and stop when no question or action remains.

Claude terminal messages use bracketed paste followed by a separate Enter key,
preserving newlines and avoiding the CLI's paste debounce. Concurrent messages
are serialized; a closed/replaced terminal never receives a delayed Enter.
Codex queues inbound messages while busy and automatically starts them in order
after the active turn and any pending request finish. `status: "queued"` means
accepted for automatic delivery, not an unsent draft; do not resend it. Queues
are bound to the current panel process and are cancelled when it closes.
`list_panels.queued_messages` reports the waiting Codex message count. Cyclic
`wait_for_reply` calls fall back to nonblocking delivery to avoid deadlocks.
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

Empty panels keep an explicit `materialized: false` state, including when ready
events beat the configure response. Previously, merging an undefined event state
could erase that flag and make autosave retain an ID with no rollout. Regression
tests cover both an empty panel and a real first turn arriving during startup.
The separate `resumable` flag records saved empty terminal metadata, without
pretending that a first turn exists. Failed terminal preparation shows a retry
state, never a temporary chat composer or an automatically substituted thread.
Existing missing-rollout errors show recovery choices: retry the same ID, find a
saved conversation, or explicitly start a new conversation. Tessera does not
silently substitute another thread when a saved transcript is unavailable.

## Build and test

```powershell
npm ci
npm test
node tools/test-terminal-cursor.mjs
node tools/test-terminal-scroll.mjs
# With npm run dev running in another terminal:
node tools/test-panel-ui.mjs
node tools/test-codex-startup-ui.mjs
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Stable

# Optional native empty-terminal check: isolated home, loopback-only provider,
# no account credentials or model turns. Supply the native executable path.
$env:TESSERA_CODEX_TEST_EXECUTABLE = 'C:\path\to\codex.exe'
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Stable -CodexStartup

# Optional: uses the existing account for two tiny model turns, then resumes them.
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Live

npm run build:preview
powershell -ExecutionPolicy Bypass -File tools/promote-preview.ps1
```

For an opt-in live UI check, start only the preview with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, then run
`node tools/smoke-preview.mjs http://127.0.0.1:9222 C:\path\to\scratch-project`.
It verifies a chat turn, empty terminal attachment, and two turns typed
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
junction to the same folder for compatibility with existing paths. Codex support
and its follow-up fixes are merged into the default `master` branch. Preview and
stable builds still have separate app identities and state; returning to the
stable installed app requires no Git operation.

Panel messaging runs inside Tessera's Rust backend; its complete server source
and bundled Claude instructions are in this repository. It needs no separate
MCP process or repository. User-configured MCP servers are optional. Codex uses
the installed Codex CLI and existing login, rather than a custom local Codex MCP.

## Implementation map

For the terminal scroll investigation, rendering/resize ownership and regression
checks, see [Terminal rendering](terminal-rendering.md).

- `src-tauri/src/codex/`: executable discovery, owned JSON-RPC transports, session
  lifecycle, model/history discovery, approvals, MCP configuration, terminal setup.
- `src/components/codex/`: provider setup, history browser, chat/terminal panel,
  approval/question cards and MCP forms.
- `AgentPanelHeader.tsx` and `ImageAttachmentButton.tsx`: shared Claude/Codex
  chrome, native image picker, previews and visible picker errors.
- `src/lib/terminalCursor.ts`: a display-only guard for temporary ConPTY cursor
  positions during thinking. The actual terminal buffer, PTY bytes and cursor
  position reports are unchanged. Idle/approval menus retain the native cursor;
  Claude terminals use the same rule while their interrupt hint is displayed.
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

The cursor investigation captured output from the installed Codex 0.154.0 through
Windows ConPTY and replayed Tessera's 5 ms batches in real xterm. The replay
reproduced 12 visible caret positions in the transcript; the guard suppressed all
12 while keeping the caret at the input. This is the same class of transient
Windows redraw problem described in [Codex issue #39710](https://github.com/openai/codex/issues/39710).
`tools/replay-terminal.mjs <capture.jsonl>` can replay another timestamped capture.
The deterministic cursor checks cover thinking/footer redraws, multiline input,
normal menus, focus, hidden cursors, disposal, and unchanged cursor reports.
The browser component checks cover the shared header, rename/cancel, color picker,
model/effort controls, native-picker IPC, image-only sends for both providers,
cancellation/errors, stream-time draft selection, and narrow panels.
They also verify missing-transcript recovery without automatically replacing
the saved identity. Native Windows image selection was exercised for both
providers with a real PNG; both models correctly identified its color.

On the development PC, the preview was also exercised through its actual WebView2
UI: CLI login and model discovery, chat output, MCP approval submission, history
restoration after app restart, new terminal attachment, a second native terminal
turn on the same thread, Claude-to-Codex and Codex-to-Claude reply waits, turn
interruption, and exact-thread restart. The stable installed executable's SHA-256
was checked before and after installation of the preview.
The follow-up build also passed a full app restart with one chat turn, two native
terminal turns, and an unsent terminal panel. Both real conversations retained
their exact IDs and all messages; the empty panel reopened without a resume error.
The live session/subwindow wording check discovered `list_panels` and
`send_to_panel`, obtained approval, and received the named Claude panel's reply.

The repository still has dependency audit findings outside this provider change.
The added test tooling uses patched Vitest 3.2.7; production dependency upgrades
were kept out of this feature branch.
