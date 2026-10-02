# Antigravity: Google's `agy` CLI as a coding agent

Antigravity panels run Google's official Antigravity CLI (`agy`). It is an independent
engine with its own sign-in: Claude Code, Codex and OpenCode launch, authentication and
storage paths are untouched. Verified on native Windows with **agy 1.2.15**.

## Setup

1. Install the CLI ([official instructions](https://www.antigravity.google/docs/cli/install/)).
   Windows PowerShell:

   ```powershell
   irm https://antigravity.google/cli/install.ps1 | iex
   ```

   It installs to `%LOCALAPPDATA%\agy\bin\agy.exe` (macOS/Linux: `~/.local/bin/agy`).
   Tessera does not install or update it.
2. Sign in once with the CLI's own flow: run `agy` in any terminal (or open an Antigravity
   **Terminal** panel) and complete the browser sign-in. The token is kept by the CLI in the
   OS credential store (Windows Credential Manager). Tessera never reads, stores or forwards it.
3. In Tessera click **+ → Chat** or **Terminal → Coding agents → Antigravity · Google sign-in**.
   The setup step shows whether the CLI was found, its version, and the sign-in status;
   choose the model, permissions and project folder, then **Open Antigravity chat/terminal**.
4. Optional: **Settings → Antigravity** stores defaults for new panels and a custom executable path.

Detection checks, in order: a custom path if you set one (used exactly; it never falls back),
`~/.tessera/tools/antigravity`, the official install location, `~/.local/bin`, then `PATH`.
The official location is checked explicitly because a running app keeps the `PATH` it started
with, so a CLI installed afterwards would otherwise not be found until a restart.

Sign-in status is a presence check of the CLI's Credential Manager entry (no secret is read),
or "API key" when `modelProvider` is `gemini` in `~/.gemini/antigravity-cli/settings.json` and
`GEMINI_API_KEY` is set. It cannot tell whether a token has expired; that is only known when a
turn runs, and an expired sign-in then shows as an error with **Open sign-in terminal**.
On macOS/Linux the status reads "not checked" for the same reason.

Models come from `agy models` for your account. Leaving the model empty uses the one saved in
agy's own settings (`/model` in the TUI).

## Chat panels

Chat uses the CLI's documented headless interface:
`agy --input-format stream-json --output-format stream-json`, one process per panel, resumed
with `--conversation <id>`.

- Streams assistant text, tool steps with their parameters/output/errors, warnings, and a
  line per turn with its duration and reported token usage. A conversation total reported by
  agy is shown under the composer.
- **Multiple turns** run in the same process. A second message while a turn is open is refused
  with a visible message rather than queued or interleaved.
- **Stop** ends the turn. agy 1.2.15 has no in-band cancel for a stream session (control
  messages are rejected with exit code 2), so Tessera ends that panel's process and resumes the
  same conversation by ID with your next message. The partial answer stays visible, marked as cut off.
- **History** is kept by Tessera in `~/.tessera/antigravity/<panel-storage-id>.json`, because
  agy does not replay earlier steps when a conversation is resumed. It contains what the panel
  showed (messages, tool names/parameters/output); it never contains credentials. The agent's
  own context lives in agy's conversation store.
- Text only: there is no image attachment or slash-command palette in chat. Use a terminal
  panel for those.

## Terminal panels

Terminal panels run the native `agy` TUI in a PTY, so every native feature (slash commands,
approval prompts, sign-in, workspace trust prompt) works as in any terminal.

Before the TUI starts, Tessera pins an exact conversation: it starts the headless interface
without sending anything, reads the conversation ID from its `init` event, exits it, and then
launches `agy --conversation <id>`. That costs a few seconds at startup and no model call, and
it is what makes save/restore deterministic. Limits of the installed version:

- If you switch conversations inside the TUI (for example `/new`), agy does not report the new
  ID through any supported interface, so a restart resumes the originally pinned conversation.
- The TUI gives no structured events: no chat transcript for Office/forks/panel reads, no
  activity turns, and **no token usage**. These are shown as unavailable, not as zero.
- If no sign-in is saved, the terminal starts unpinned so you can sign in; restart the panel
  afterwards to make it resumable.

## Sessions, restore and recovery

- Every panel has its own process, working directory, model, permission mode, storage ID and
  conversation. Workspace files and autosave store those values and the conversation ID,
  never credentials.
- Restoring a workspace registers each panel and shows its saved transcript **without starting
  a process or making a model call**. agy starts with the next message (chat) or when the
  terminal mounts.
- Two panels never share one conversation: a duplicated snapshot gives the conversation to the
  first panel and starts the other fresh.
- `agy --conversation <unknown-id>` does not fail: it prints a warning and silently opens a
  different conversation. Tessera compares the ID agy reports with the saved one, stops, and
  shows "conversation was not found on this PC" with **Start a new conversation here**.
  The visible transcript is kept and marked as not being in the new conversation's context.
  (agy has by then created an empty conversation of its own; that cannot be prevented.)
- Missing executable, expired sign-in, an unknown model, a crashed or killed process, and a
  failed start each end the turn as failed with the CLI's own message and a recovery action
  (**Open sign-in terminal**, **Send the last message again**, **Reconnect**, **Retry**).
  A process that exits while idle is restarted with the next message.

## Permissions

Tessera passes your choice to agy and reports what agy actually does. Nothing is approved on
your behalf, and agy's settings file is never edited.

| Choice | Flag | Chat (headless) | Terminal |
| --- | --- | --- | --- |
| Request review (default) | none | Tools that need approval are **auto-denied** and listed in the chat; the turn continues without them | agy asks you |
| Accept edits | `--mode accept-edits` | File edits accepted; other approvals still auto-denied | File edits accepted; agy asks for the rest |
| Plan first | `--mode plan` | Plans before changing anything | Plans, and asks |
| Allow everything | `--dangerously-skip-permissions` | Every tool request is approved | Every tool request is approved |

`--sandbox` is a separate checkbox. Headless mode cannot show an approval prompt, so chat has
no "allow once" button: that is a limit of the CLI's interface, not a Tessera setting. With
agy 1.2.15 a shell command under the default mode is refused, and a file written inside the
project is allowed. To allow specific commands in chat, add rules under `permissions.allow` in
`~/.gemini/antigravity-cli/settings.json` (for example `command(git)`), choose a broader mode,
or use a terminal panel. Model and permissions can be changed later from the panel menu while
the panel is idle; the process restarts and the conversation is kept.

## Groups, shortcuts, messaging and LAN

Antigravity panels are ordinary panels: grouping, moving between groups, renaming, colors,
`Alt/Ctrl+0-9` shortcuts, maximizing and workspace persistence behave as for other agents.

- **Receiving messages:** other panels (and paired LAN computers) can send to an Antigravity
  chat panel and read its recent conversation through the panel bus. Delivery goes to the
  panel's own agy process even when the panel is hidden in a group. A busy panel returns an
  explicit "still working" error. Terminal panels receive messages by paste-and-Enter and
  have no readable transcript.
- **Sending messages: not available.** agy 1.2.15 loads MCP servers only from its global
  `~/.gemini/config/mcp_config.json` or from plugins; it has no per-session MCP option. Giving
  one panel the Tessera panel tools would mean writing a per-panel address and token into your
  global Antigravity configuration, so the Antigravity agent cannot call `list_panels`,
  `send_to_panel` or `read_panel` itself. Other agents can still hand work to it.
- **Forks:** an Antigravity chat can be forked into any provider. Forking *into* Antigravity
  attaches the earlier conversation to the first message (agy has no history import); a forked
  terminal starts with `--prompt-interactive` carrying the newest 12,000 characters.

## Activity, token flow and Office

- Chat turns are recorded natively in Activity with the chat name, provider, model, your
  message, the response, tool names, status and token usage. Recording does not depend on the
  panel being visible.
- agy's `result.usage` is cumulative for the whole conversation, including across resumed
  processes; each turn stores the difference from a baseline saved in the same transaction.
  A conversation first seen mid-life (restored on a new PC or before this build) uses only the
  turn's own reported steps and says so. A stopped turn keeps only its completed steps. A turn
  with no reported usage is **unavailable**, never zero. Repeated events for a finished turn
  change nothing. `thinking_tokens` are part of output and are not added twice.
- A message received from another panel links to its recorded handoff. Handoffs *from*
  Antigravity do not exist (see above).
- Office: each chat panel has a character whose station follows the reported tool, and which
  stays working for the whole open turn however quiet the output is. It is idle only after agy
  reports the turn's end, "waiting" when agy ends a turn awaiting your reply, and in error on a
  failed turn. Coins come from completed Activity turns, once per turn ID; stopped and failed
  turns earn nothing. Terminal panels have a character with "no structured activity reported".

## Verification

Mocked (no CLI, no model calls):

```
npm test
npm run build
powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Stable
```

With `npm run dev -- --host 127.0.0.1` running: `node tools/test-antigravity-ui.mjs`,
`node tools/test-office.mjs`, `node tools/test-activity.mjs`.

Live (real, signed-in CLI; a few small model calls each):

```powershell
node tools/test-antigravity-cli.mjs                      # CLI contract the integration relies on
$env:TESSERA_ANTIGRAVITY_TEST_EXECUTABLE = "$env:LOCALAPPDATA\agy\bin\agy.exe"
.\tools\test-rust.ps1 -Stable -Antigravity               # native sessions, resume, stop, PTY
```

Live in the app (Preview build only, see the Codex guide for the Preview setup):
`node tools/smoke-antigravity.mjs http://127.0.0.1:9222 C:\path\to\scratch-project`.
