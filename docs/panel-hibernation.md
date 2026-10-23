# Panel hibernation

Unused local agent panels hibernate after one hour by default. Change this in
**Settings → General → Hibernate unused agent panels**, or choose Never. The
Panel controls menu also has **Hibernate panel**. A dimmed preview keeps the
last visible terminal text (or recent chat text); **Wake panel** reconnects the
same saved conversation, model and permissions without sending a prompt.

Click the **RAM indicator** in the status bar for **Hibernate unused panels**.
This one-off action hibernates eligible panels idle for at least 30 minutes of
Tessera running time, even if automatic hibernation is disabled. The menu shows
the eligible count and the result; active work, focus, approvals and drafts are
still protected, and recently used panels are checked again before stopping.

The idle clock accumulates only while Tessera runs. Closing Tessera or suspending
the computer does not add time. Auto-save stores each panel's accumulated idle
duration and sleeping state with its normal conversation identity. Restoring a
workspace never starts sleeping panels. Their layout positions and locks remain
unchanged. HTML apps, websites, API-only chats and remote panels are excluded.

Focused panels, pending approvals/questions, unsent drafts, starting sessions and
agents working quietly stay awake. Automatic sleep requires known idle activity:
Claude terminal activity must be freshly observed, and Codex/OpenCode/Antigravity
chat activity comes from their provider state. Antigravity's native terminal does
not expose reliable busy/idle information, so it supports manual hibernation only.
Periodic account quota notifications do not count as work.

Native cleanup closes both the PTY and the provider's background process. On
Windows their owned child process trees, including stdio MCP children, are killed.
Shared/external MCP services are not shut down. Suspended panels reject incoming
panel messages instead of silently spawning an agent. Renderers, retained xterm
parsers and provider pollers are released too. Preview files are bounded plain
text stored in Tessera's data directory, outside browser localStorage; they are
not screenshots or live terminal sessions. Full conversation history remains in
the provider's usual storage.

Verification:

- `npm test` covers time accounting, busy/draft protection, snapshot restore,
  provider guards, same-session wake and cleanup failures.
- `powershell -NoProfile -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Stable`
  includes an isolated parent/child process cleanup test on Windows.
- With Vite running, `node tools/test-panel-hibernation.mjs <vite-url>` exercises
  real panel UI, retained text, app reload, waking from an unfocused tile and
  automatic hibernation with mocked native IPC. It never opens a user session.
- `node tools/test-memory-hibernation.mjs <vite-url>` checks the RAM menu,
  30-minute cleanup, busy protection, failed cleanup/retry and narrow windows.
