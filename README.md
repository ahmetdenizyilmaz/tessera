# Claude GUI

A native desktop app that runs **multiple Claude Code sessions side by side** in a
tiling, resizable mosaic — each session as its own chat or terminal panel, all in
one window.

Built with [Tauri 2](https://v2.tauri.app/) (Rust) + React 19. It wraps the
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI, so every panel
is a real `claude` session with full context, tools, and MCP — just with a
window, tabs, and a layout instead of a lone terminal.

> **Status:** beta. Actively developed; expect rough edges.

---

## Features

- **Tiled multi-session workspace** — open many Claude Code sessions at once in a
  resizable mosaic. Focus a panel and it grows; the others yield space.
- **Chat _and_ terminal panels** — view any session as a rich chat (markdown,
  syntax highlighting, image paste) or as a raw xterm terminal running the TUI.
- **Panel groups & tabs** — collapse related panels into a tabbed group; maximize
  one panel to fill the area and reach the rest via tabs (`Ctrl+Tab` /
  `Ctrl+Shift+Tab`).
- **Panel-to-panel messaging** — an in-app MCP server lets one Claude session
  list the other open panels and send them messages (delegate work, ask a peer,
  hand off a result), fire-and-forget or waiting for a reply.
- **`cgui` command-line launcher** — run `cgui` in any directory to open a new tab
  rooted there (like `code .`); if the app is already running it just adds a tab.
- **Session management** — resume/continue past conversations, browse session
  history, and attach external `claude --resume` sessions by folder drop or paste.
- **Multiple LLM providers** — talk to the Anthropic API directly (bring your own
  key) in a panel alongside your Claude Code sessions.
- **MCP server manager** — add and toggle MCP servers; they are wired into new
  panels automatically.
- **Permission-aware** — permission prompts, plan mode, and per-panel permission
  modes (`auto` / `manual` / skip) surface as in-app cards.
- **Usage dashboard** — token/usage analytics and session breakdowns.
- **Workspaces** — save and reload an entire layout of panels.
- **Plugins** — small built-in tools (notepad, timer) with a simple manifest.

---

## Requirements

- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** installed
  and on your `PATH` (or at `~/.local/bin`). The app spawns `claude` for every
  session — it will not work without it.
- **[Node.js](https://nodejs.org/)** 18+ and npm.
- **[Rust](https://www.rust-lang.org/tools/install)** (stable) with the Tauri 2
  prerequisites for your OS — see the
  [Tauri setup guide](https://v2.tauri.app/start/prerequisites/).
- **Windows only:** the GNU binutils `windres` must be on `PATH` to compile the
  app resources. If you use [MSYS2](https://www.msys2.org/), add
  `C:\msys64\mingw64\bin` to `PATH` before building.

---

## Getting started

```bash
# install frontend dependencies
npm install

# run the app in development (hot-reloads the UI)
npm run tauri dev

# produce an optimized build + installer
npm run tauri build
```

The production build and NSIS installer land under
`src-tauri/target/release/` (and `.../bundle/`).

### Handy scripts

- `build_dev.bat` — quick `cargo build` of the Rust side (Windows).
- `tools/promote-stable.ps1` — copy a fresh release build to a stable install
  location and install the `cgui` launcher into `~/.local/bin` (Windows).

---

## The `cgui` launcher

After a build is promoted, `cgui` behaves like `code .` for Claude GUI:

```bash
cd path/to/project
cgui            # opens a new tab rooted here (launches the app if needed)
cgui subdir     # opens ./subdir
cgui C:\path    # opens that path
```

If the app is already open, the single-instance handler forwards the directory to
the running window and adds a tab instead of starting a second copy.

---

## Project structure

```
src/                      React + TypeScript frontend
  components/             UI: chat, terminal, dialogs, settings, analytics, ...
  store/                  zustand stores (instances, layout, chat, settings, ...)
  lib/                    bridges to Rust, session/workspace logic, panel bus
  hooks/                  React hooks (PTY, autosave, ...)
  engine/                 layout / mosaic engine
src-tauri/                Rust backend (Tauri)
  src/stream/             Claude Code stream-json process management
  src/pty/                terminal (PTY) sessions
  src/panelbus/           in-app MCP server for panel-to-panel messaging
  src/sessions/           session files, history, usage parsing
  src/llm/                direct LLM providers (Anthropic API)
  src/mcp/                MCP config generation
  src/db/                 local SQLite storage
tools/                    CLI launcher + release/promote scripts
```

---

## Data & privacy

- App data (local SQLite DB, generated MCP config, the bundled plugin) lives in
  `~/.claude-gui/`.
- API keys entered in **Settings → LLM Providers** are stored in the OS keychain
  via the system keyring — never in the repo or plaintext config.
- Product analytics are **off unless an analytics key is provided at runtime**;
  no key is bundled in this repository.

---

## Tech stack

Tauri 2 · Rust · React 19 · TypeScript · zustand · Vite · xterm.js · dnd-kit ·
recharts · PixiJS

---

## License

See [LICENSE](LICENSE).
