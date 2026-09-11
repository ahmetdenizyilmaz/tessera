// Served only by the opt-in UI test; production builds use index.html.
import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { Terminal } from "@xterm/xterm";
import { CodexPanel } from "../src/components/codex/CodexPanel";
import { AgentPanelHeader } from "../src/components/terminal/AgentPanelHeader";
import { ChatInput } from "../src/components/chat/ChatInput";
import { useInstanceStore } from "../src/store/instanceStore";
import { useCodexStore } from "../src/store/codexStore";
import "../src/styles/global.css";
import "../src/styles/chat.css";
import "../src/styles/codex.css";
import "@xterm/xterm/css/xterm.css";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5i8AAAAASUVORK5CYII=";
const model = {
  id: "test",
  model: "test-model",
  displayName: "Test model",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [
    { reasoningEffort: "medium" },
    { reasoningEffort: "high" },
  ],
  inputModalities: ["text", "image"],
};
window.calls = [];
window.pick = ["C:\\images\\example.png"];
mockIPC(
  async (command, args) => {
    window.calls.push({ command, args });
    if (command === "plugin:dialog|open") return window.pick;
    if (command === "read_chat_image") {
      if (window.imageError) throw new Error("Cannot read image");
      return png;
    }
    if (command === "save_chat_image")
      return "C:\\scratch\\.tessera-images\\test.png";
    if (command === "codex_discover")
      return { models: [model], account: { account: { type: "chatgpt" } } };
    if (command === "codex_configure")
      return {
        generation: "fixture",
        threadId: "thread-fixture",
        thread: { id: "thread-fixture", cwd: "C:\\scratch", turns: [] },
        events: [],
        requests: [],
        busy: false,
        alive: true,
      };
    if (command === "codex_send") return {};
    if (command === "list_slash_commands" || command === "list_project_files")
      return [];
    return null;
  },
  { shouldMockEvents: true },
);
const instance = (id, provider) => ({
  id,
  name: provider === "codex" ? "Codex test" : "Claude test",
  color: "#4a9eff",
  status: "running",
  config: {
    agentProvider: provider,
    panelView: "chat",
    cwd: "C:\\scratch",
    model: "test-model",
    systemPrompt: "",
    codex: { effort: "medium" },
  },
});
useInstanceStore.setState({
  instances: new Map([
    ["codex-ui", instance("codex-ui", "codex")],
    ["claude-ui", instance("claude-ui", "claude")],
  ]),
});
window.codexStore = useCodexStore;
window.instanceStore = useInstanceStore;
window.Terminal = Terminal;
createRoot(document.getElementById("root")).render(
  <div style={{ display: "flex", height: "600px", gap: 10, padding: 10 }}>
    <div id="codex" style={{ width: "48%", height: "100%" }}>
      <CodexPanel instanceId="codex-ui" />
    </div>
    <div
      id="claude"
      className="terminal-panel"
      style={{ width: "48%", height: "100%", borderTop: "2px solid #4a9eff" }}
    >
      <AgentPanelHeader
        instanceId="claude-ui"
        status="Ready"
        statusColor="#51cf66"
        metadata="Claude · sonnet · auto"
        onClose={() => {}}
      />
      <div style={{ flex: 1 }} />
      <ChatInput
        instanceId="claude-ui"
        isReady
        onSend={(text, images) =>
          window.calls.push({ command: "claude-send", args: { text, images } })
        }
      />
    </div>
  </div>,
);
