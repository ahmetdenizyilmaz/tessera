# OpenCode: one coding agent, multiple model providers

OpenCode is an independent engine, not a Claude Code wrapper. Tessera keeps the
existing Claude Code and Codex launch, authentication, and storage paths intact.

## Setup

1. Install the [OpenCode CLI](https://opencode.ai/docs/cli/) separately. For example,
   `npm install -g opencode-ai`, or use an official native executable. This integration
   has been tested on native Windows with **1.18.32**.
2. In **Settings → OpenCode**, select a provider, save its key if required, and
   discover/select a model. **OpenCode CLI & advanced → Check OpenCode CLI** checks
   detection; an executable override can point to a native executable or npm shim.
3. Save defaults. They apply to new panels only.
4. Click **+ → Chat / Terminal → OpenCode**, choose the project folder and permissions,
   then open the panel. Both views use OpenCode tools, not the plain API-chat backend.

Detection checks a Tessera-scoped `~/.tessera/tools/opencode` installation, common
OpenCode/npm locations, and PATH. Preview uses `~/.tessera-preview` instead. Tessera
does not install or upgrade the CLI automatically, change global login, or download models.

## Providers

| Choice | Credentials / endpoint |
| --- | --- |
| OpenRouter | Existing `openrouter` key in Tessera's OS keychain; model ID such as `vendor/model` |
| OpenAI API | Existing `openai` API key; separate from a ChatGPT subscription |
| Anthropic API | Existing `anthropic` API key; separate from the Claude Code subscription/login |
| Google Gemini API | Existing `gemini` API key |
| Ollama | Default `http://127.0.0.1:11434/v1`; start the server and load a tool-capable model |
| LM Studio | Default `http://127.0.0.1:1234/v1`; enable its local server and load a tool-capable model |
| Custom compatible API | An OpenAI-compatible base URL and exact model ID; optional endpoint-scoped key |

OpenCode's [provider documentation](https://opencode.ai/docs/providers/) describes
the provider integrations. Compatibility depends on the endpoint and the model's tool
calling, not just whether it can return chat text. Set context/output limits for local
models to match the actual server configuration. These settings do not enlarge a model.

Model discovery requests the endpoint's model list; it does not generate a response or
incur a model inference charge. It can fail if the local server is stopped, authentication
is wrong, or `/models` is unsupported. Entering a model ID manually remains possible.

Use HTTPS for remote API servers. Plain HTTP is intended for trusted local endpoints.
The key for a custom/local endpoint is scoped to its normalized base URL. Keys are not
included in panel configs, defaults, `.ady` files, or child-process command arguments.

## Views, history, and permissions

- Chat renders text/Markdown, reasoning sections, tool inputs/outputs, errors, permission
  requests, and multiple-choice/free-text questions. It supports stopping a running turn.
- Terminal attaches the official native OpenCode TUI to the panel's managed server.
  OpenCode slash commands and other native features remain available there. Chat currently
  has a text composer; it does not implement the TUI slash-command palette or image uploads.
- Each panel owns an authenticated **loopback-only** server and independent XDG data/config/
  state/cache directories under `~/.tessera/opencode/<storage-id>`. This costs one server
  process per panel but prevents concurrent providers from overwriting each other's config.
- Panel saves retain the stable storage ID, exact session ID, provider/model/endpoint,
  context limits, permissions, project folder, and chosen view. Native new root sessions
  and model/agent changes made when sending a message update the saved identity/config.
  Subagent conversations do not replace the panel's root session.
- History belongs to the hosting PC's OpenCode data. A workspace file references it; it
  does not export the OpenCode database or credentials. Restoring a missing session reports
  the problem instead of silently starting a different conversation.
- Closing a local panel stops its server/PTY but keeps its saved history on disk. Closing
  a remote tile or remote group only hides it on that viewer, just as for other providers.
- **Ask before actions** permits project reads/searches and prompts for other tools. **Allow
  all** explicitly removes these tool approval checks. Neither is an OS-level sandbox.
  Project OpenCode configuration/plugins are off by default; enable only for trusted projects.
- Tessera supplies its panel-bus MCP endpoint without editing Claude's MCP configuration.
  Cross-panel/LAN reads use OpenCode history; terminal sharing remains real terminal frames.
  Sending to a busy OpenCode panel returns an explicit busy error rather than interrupting
  or silently queuing a different turn. The managed connection does not import other MCP
  entries from Tessera's Claude/Codex MCP manager; trusted OpenCode project config can supply them.
- Cross-agent forks import a text context message with `noReply`, so creation makes no
  model call and does not ask for a summary. An explicitly configured fork opener still runs.

## Verification

```
npm test
npm run build
powershell -File tools/test-rust.ps1 -Stable
node tools/test-opencode-cli.mjs path/to/opencode.exe
```

The CLI contract test starts a fake local model server, tests streaming, rejection of
command execution, structured questions, cancellation, and exact history resume. It
does not read provider keys or use paid models. For the native managed-server/PTY test:

```powershell
$env:TESSERA_OPENCODE_TEST_EXECUTABLE = 'C:\path\to\opencode.exe'
.\tools\test-rust.ps1 -Stable -OpenCode
```

With the Vite development server running, `node tools/test-opencode-ui.mjs` verifies
the real React panels and xterm with mocked IPC, including correct engine dispatch.
