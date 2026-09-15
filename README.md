<div align="center">

<img src="assets/tessera-banner.png" alt="Tessera" width="760">

<p>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-6B7391?style=flat-square&logo=windows&logoColor=white">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-E8B04B?style=flat-square&logo=tauri&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-4C6EF5?style=flat-square&logo=react&logoColor=white">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-6B7391?style=flat-square&logo=rust&logoColor=white">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-4C6EF5?style=flat-square"></a>
</p>

<strong>One workspace for coding agents, cloud LLMs, and local models.<br>Claude Code, Codex, OpenRouter, Ollama, and more, side by side.</strong>

</div>

---

**Tessera** is a native desktop workspace for multiple AI providers. Run Claude Code and Codex
coding sessions, chat with cloud models, or use models running on your own machine, all in a
resizable mosaic. Mix providers in the same window, group related work, and let coding-agent
panels message each other. Built with [Tauri 2](https://v2.tauri.app/) (Rust) + React 19.

> **Status:** beta. Actively developed; expect rough edges.

## Supported providers

| Provider or connection | How it works in Tessera | What you need |
| --- | --- | --- |
| **Claude Code** | Coding-agent chat or native terminal, with tools and MCP | Claude Code CLI and its configured login |
| **Codex** | Coding-agent chat or native terminal, with model/effort selection, permissions, and MCP | Codex CLI and its configured login |
| **OpenRouter** | Route a Claude Code panel to a model selected from OpenRouter's catalog | Claude Code CLI and an OpenRouter API key |
| **Anthropic, OpenAI, Gemini APIs** | Direct streaming chat panels | An API key for the selected provider |
| **Ollama** | Direct local chat, or a model-backed Claude Code panel through its compatible endpoint | A running Ollama server and an available model; CLI required for the coding-agent route |
| **LM Studio** | Direct local chat with model discovery | A running LM Studio server and a loaded model |
| **Custom gateway** | Route a Claude Code panel to a custom Anthropic-compatible base URL | Claude Code CLI and a compatible server/model |

Coding-agent panels provide the CLI's file, command, and MCP tools. Direct API and local chat
panels provide streaming conversations. Available models and tool support depend on the chosen
provider, endpoint, and model.

See the [Codex guide](docs/codex-provider.md) for login discovery, session resume, permission
defaults, and the separate Preview build.

---

## Features

- **Tiled multi-provider workspace** — open coding agents, cloud chats, and local models together. Focus a panel and it
  grows; the others yield space.
- **Chat _and_ terminal panels** — use Claude Code and Codex in rich chat or native xterm terminal
  panels, with image attachments. Direct LLM panels offer streaming chat with markdown and syntax highlighting.
- **Panel groups & tabs** — collapse related panels into a tabbed group; maximize one to fill the
  area and reach the rest with `Ctrl+Tab` / `Ctrl+Shift+Tab`.
- **Panel-to-panel messaging** — an in-app MCP server lets coding-agent sessions list the other open panels
  and message them (delegate, ask a peer, hand off a result), fire-and-forget or awaiting a reply.
- **Encrypted LAN subgroups** — pair two Tessera computers on the same private subnet and use each
  computer's existing Claude and Codex panels as a persistent remote group. No internet relay is involved.
- **`cgui` command-line launcher** — run `cgui` in any directory to open a new tab rooted there,
  like `code .`; if the app is already running it just adds a tab.
- **Session management** — resume Claude Code and Codex conversations and save whole workspaces.
  Attach external `claude --resume` sessions by folder drop or paste.
- **Cloud and local models** — configure API keys and local server addresses in **Settings → LLM Providers**.
  Discover models from OpenRouter, Ollama, and LM Studio.
- **MCP server manager** — add and toggle MCP servers for coding-agent panels.
- **Permission controls** — see coding-agent questions and approvals in the app and configure
  per-panel permissions, with separate Claude and Codex defaults.
- **Usage dashboard, workspaces & plugins** — token analytics, save/reload whole layouts, and small
  built-in tools (notepad, timer).

---

## Install

**Grab an installer from the [Releases page](../../releases)** — no Rust or Node needed to install
Tessera itself. Run the Windows setup executable. Check the release notes for the features included
in that build; the source instructions below build the code in this checkout.

Set up the connections you want to use:

- **Claude Code:** install the Claude Code CLI and configure its login. Tessera discovers it on
  `PATH` or in supported install locations such as `~/.local/bin`.
- **Codex:** install the Codex CLI and configure its login. Tessera reuses that login; the
  [Codex guide](docs/codex-provider.md) covers detection and executable overrides.
- **Cloud API chat:** enter the provider's API key in **Settings → LLM Providers**.
- **Local chat:** start Ollama or LM Studio, make a model available, and configure its server URL
  in **Settings → LLM Providers**. Direct chat panels work independently of the coding-agent CLIs.

> Windows may show a SmartScreen prompt because the installer isn't code-signed yet —
> click **More info → Run anyway**.

---

## Getting started

1. Open Tessera and click **+** to create a session.
2. Choose **Chat** or **Terminal**, then choose a provider or gateway. The choices reflect the
   selected view; direct API and local chat providers appear under **Chat**.
3. Select a model and, for coding agents, a project folder and permissions. Add the panel.
4. Add more panels with any supported provider, then resize, group, or maximize them as needed.

For API keys and local connection settings, open **Settings → LLM Providers**. Codex's starting
permission mode is under **Settings → General → Default Codex permissions**.

To connect another Tessera computer, enable **Settings → Local Network → Share on local network**
on both PCs. Generate a one-time code on one computer, then enter its displayed address and code on
the other. Windows may ask for firewall access; allow **Private networks** only. Paired devices
reconnect automatically and remain visible as offline groups when unavailable.

---

## Building from source

Only needed if you want to hack on Tessera itself:

- **[Node.js](https://nodejs.org/)** 18+ and npm.
- **[Rust](https://www.rust-lang.org/tools/install)** (stable) with the
  [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.
  On Windows the MSVC toolchain (VS Build Tools C++) is all you need.
- Using the GNU toolchain instead? Then `windres` must be on `PATH` — with
  [MSYS2](https://www.msys2.org/), add `C:\msys64\mingw64\bin` before building.

```bash
npm install            # install frontend dependencies
npm run tauri dev      # run the app (hot-reloads the UI)
npm run build:stable   # regular Tessera app + installer
```

Build output and the NSIS installer land under `src-tauri/target/release/`.

`main` is the production branch. For a Windows build with the bundled Codex
history-rendering fix, prepare the renderer with
`tools/build-codex-terminal.ps1` before building Tessera. The release workflow
does this automatically. See [renderer build instructions](patches/codex-terminal/README.md).

Use `npm run build:preview` to build **Tessera Preview**, which has its own app identity and state
directory. See [Preview build and installation](docs/codex-provider.md) for details.

**Handy scripts (Windows):** `build_dev.bat` for a quick `cargo build`, and
`tools/promote-stable.ps1` to copy a release build to a stable install location and install the
`cgui` launcher into `~/.local/bin`.

---

## The `cgui` launcher

Once promoted, `cgui` behaves like `code .` for Tessera:

```bash
cd path/to/project
cgui            # open a new tab rooted here (launches the app if needed)
cgui subdir     # open ./subdir
cgui C:\path    # open that path
```

If the app is already open, the directory is forwarded to the running window as a new tab instead of
starting a second copy.

---

## Project structure

```
src/                      React + TypeScript frontend
  components/             UI: chat, terminal, dialogs, settings, analytics, ...
  store/                  zustand stores (instances, layout, chat, settings, ...)
  lib/                    bridges to Rust, session/workspace logic, panel bus
  engine/                 layout / mosaic engine
src-tauri/                Rust backend (Tauri)
  src/stream/             Claude Code stream-json process management
  src/codex/              Codex app-server, sessions, permissions, and terminal setup
  src/pty/                terminal (PTY) sessions
  src/panelbus/           in-app MCP server for panel-to-panel messaging
  src/lan/                encrypted same-subnet pairing and remote-panel transport
  src/sessions/           session files, history, usage parsing
  src/llm/                cloud API and local model chat providers
  src/db/                 local SQLite storage
tools/                    cgui launcher + release/promote scripts
```

---

## Data & privacy

- App data (local SQLite DB, generated MCP config, the bundled plugin) lives in `~/.tessera/`;
  Preview uses `~/.tessera-preview/`. Coding-agent conversations also use their CLI's own storage.
- Cloud connections send requests to the selected provider. Local chat uses the configured
  Ollama or LM Studio endpoint.
- API keys entered in **Settings → LLM Providers** are stored in the OS keychain via the system
  keyring — never in the repo or plaintext config.
- LAN device identities are stored in the OS keychain. Paired-computer names, addresses, and public
  keys are stored locally under `~/.tessera/`; one-time pairing codes remain in memory and expire.
- LAN sharing accepts only directly connected private IPv4 subnets. It has no discovery broadcast,
  cloud relay, UPnP, or automatic router configuration. Paired devices can see panel metadata, read
  recent transcripts, and deliver messages, but cannot access files, raw shells, or approval controls.
- Product analytics are **off unless an analytics key is supplied at runtime**; none is bundled here.

---

## Trademark

Tessera is an independent, unofficial desktop client and is not affiliated with or endorsed by
the providers it supports. Provider names and logos belong to their respective owners.

---

## License

[MIT](LICENSE) © Ahmet Deniz Yılmaz
