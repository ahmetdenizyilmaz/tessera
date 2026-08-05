# Claude GUI v2 — Unverified Behaviour Checklist

Everything here is **implemented, compiling, and never seen working**. It is not a
general test suite (`test_cases.md` is the older visual matrix) — it is the list of
things that could quietly be broken right now.

Work top to bottom; the first section is the one most likely to hide a real bug.

**Status key:** ⏳ untested · ✅ pass · ❌ fail (write what happened) · ⚠️ partial

Test against the **stable build** (`C:\Users\user\Apps\ClaudeGUI\Claude GUI.exe`,
promoted by `tools\promote-stable.ps1`), not `npx tauri dev` — several of these
behave differently under a dev process.

---

## 1. Process lifecycle

### 1.1 ⏳ No zombies after a clean close
Why it matters: a force-killed dev process bypasses Tauri's exit event entirely, so
every previous "test" of this proved nothing.

1. `tasklist /FI "IMAGENAME eq claude.exe"` → note the count (baseline).
2. Open three panels: two chat, one terminal. Send a message in each so all three CLIs spawn.
3. Confirm the count rose by three.
4. Close the app with the window **X** (not Task Manager, not Ctrl+C).
5. Wait 5 s, re-run the tasklist.

**Pass:** count is back to baseline.
**If it fails:** the tree-kill in `util/proc.rs` or `kill_all()` on `RunEvent::Exit` isn't firing.

### 1.2 ⏳ No zombies after closing a single tab
Open a panel, send a message, close just that tab. The count should drop by one
within a second or two.

---

## 2. Interactive prompts

### 2.1 ⏳ Permission card with Skip Permissions **off**
1. New Instance dialog → uncheck *Skip Permissions*, permission mode `default`.
2. Ask it to create a file: `write a file called scratch.txt containing "hi"`.

**Pass:** a permission card appears with Allow / Deny. **Deny** → the file is not
created and Claude says so. Repeat with **Allow** → the file appears on disk.
**Watch for:** the card never appearing (the request is arriving but not rendering),
or Allow/Deny not unblocking the turn.

### 2.2 ⏳ Plan mode approval round-trip
1. New instance with permission mode `plan`.
2. Ask for something multi-step: `add a --verbose flag to this script`.
3. Claude should present a plan and stop.

**Pass:** an approval card renders the plan as markdown; approving continues the
session in acceptEdits and it starts editing. "Keep planning" sends it back to planning.

### 2.3 ✅ AskUserQuestion (verified previously — re-check after any stream changes)
Ask: `ask me a question with a few options`. Options render as buttons; the question
is hidden while pending and the chosen answer stays visible afterwards.

---

## 3. Chat pipeline

### 3.1 ⏳ `/clear` produces genuine amnesia
1. Send `remember the number 4291`.
2. Note the CLI PID (`tasklist`).
3. Send `/clear`.
4. Send `what number did I ask you to remember?`

**Pass:** a *new* PID, and it does not know the number. A wrong answer here means
`/clear` only wiped the UI — the old failure mode.

### 3.2 ⏳ Image paste
Copy a screenshot to the clipboard, paste into the chat input, send.

**Pass:** a thumbnail in the user bubble, and Claude describes the image.
**Fail mode to watch for:** it says `[Images: C:\...]` — that's the old literal-text bug.

### 3.3 ⏳ Transcript restore across a real restart
1. Have a conversation of 3+ turns.
2. Close the app with **X**. Reopen.

**Pass:** the panel returns with its directory and the conversation text.
**Known limitation, not a bug:** restored turns are plain text — tool widgets,
thinking blocks and question cards do not come back. Only new messages render fully.

---

## 4. Sessions

### 4.1 ⏳ Attach an external session — folder drop
Drag a folder from Explorer onto a panel. Dialog opens with that folder pre-filled;
pick Chat or Terminal; a new panel opens in that directory.

### 4.2 ⏳ Attach — pasted resume command
File → Attach External Session, paste `cd 'C:\some\path' ; claude --resume <uuid>`.
It should parse the path and the session id and reopen that conversation.

### 4.3 ⏳ Attach — external sessions list
Same dialog, bottom section: sessions started outside the app should be listed and
openable.

### 4.4 ⏳ Resume guard
Delete a project's session JSONL from `~/.claude/projects/<encoded-cwd>/` while the
app is closed, then reopen. **Pass:** a fresh session starts silently. **Fail:** the
old `No conversation found with session ID: …` error.

---

## 5. Claude (API) provider — never called live

### 5.1 ⏳ Key storage
Settings → LLM Providers → Claude (API) → paste an `sk-ant-…` key → Save. Reopen
Settings: it should show `•••• (saved)`.

### 5.2 ⏳ Streaming chat
`+` → Claude (under *Chat via API key*) → pick `claude-opus-5` → send a message.

**Pass:** text streams in.
**Expect:** a pause before the first token — Opus 5 thinks by default and thinking
text is not rendered.
**Watch for:** an HTTP 400. If the body mentions `temperature` or `system`, the
request shape in `src-tauri/src/llm/providers.rs` is wrong.

### 5.3 ⏳ System prompt actually applies
Create a panel with system prompt `Always answer in exactly three words.` and check
it obeys. This path was fixed at the same time and affects OpenAI/Gemini/Ollama/LM
Studio too — worth a spot check on one of those.

### 5.4 ⏳ Known cosmetic issue
The temperature slider shows for Claude (API) but does nothing — current Claude
models reject `temperature`. Not yet hidden.

---

## 6. MCP  *(after the Phase 2 wiring lands)*

### 6.1 ⏳ A configured server reaches the CLI
Add a server in McpManager, enable it, open a **new** panel, run `/mcp`.
**Pass:** the server is listed. Before this round it never was.

### 6.2 ⏳ Disabling takes effect
Toggle it off, open another new panel, `/mcp` → gone.

---

## 7. Panel messaging  *(after Phase 4)*

### 7.1 ⏳ Discovery
Two chat panels in **different** directories. In A: `list the other panels open in
this app`. **Pass:** B appears with the right name and cwd; A is marked as self.

### 7.2 ⏳ Fire-and-forget send
In A: `send a message to panel B asking what directory it's in`.
**Pass:** B's transcript shows the message with a `[panel-message from "A"]` prefix
and B answers in its own panel.

### 7.3 ⏳ Wait for reply
In A: `ask panel B what directory it's in and wait for the answer`.
**Pass:** A reports B's cwd in its own turn.

### 7.4 ⏳ Blocked target is reported, not waited out
Put B in `default` permission mode and make it hit a permission card, then have A
`ask panel B …` with wait. **Pass:** A comes back promptly saying B is waiting for
user input — not a 60 s timeout.

### 7.5 ⏳ Loop guard
Tell A and B to keep messaging each other. **Pass:** it stops at hop 3.

### 7.6 ⏳ Terminal target
Send to a terminal panel. **Pass:** the text appears in the TUI and submits. If it
appears but doesn't submit, the line ending is wrong (`\r` vs `\n`).

### 7.7 ⏳ Error cases
- Send to self → refused with a clear message.
- Send to a name that doesn't exist → error lists the available panels.
- Rename two panels the same, then send by that name → error lists both ids.

### 7.8 ⏳ Slash commands
Type `/` in the chat input — `/panels`, `/send`, `/ask-panel` should be listed, and
the name inserted must be the one the CLI actually accepts (plugin commands may be
namespaced `/claude-gui-panels:send`).

---

## Notes for whoever runs this

- Rust builds need `C:\msys64\mingw64\bin` on `PATH` (for `windres`), and the stable
  exe must not be running or the link step fails with *Access is denied*.
- `npx tsc --noEmit` and `cargo check` are both expected clean.
- When something fails, capture the CLI stderr — the app surfaces it as a collapsible
  warning under the message, and it is usually the actual cause.
