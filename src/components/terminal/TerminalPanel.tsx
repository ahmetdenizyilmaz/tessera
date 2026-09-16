import { CodexPanel } from "../codex/CodexPanel";
import { useState, useEffect, useCallback } from "react";
import { useInstanceStore } from "../../store/instanceStore";
import { useLayoutStore } from "../../store/layoutStore";
import { cleanupPty, restartPty } from "../../hooks/usePty";
import { useEventBusStore } from "../../store/eventBusStore";
import { destroyTerminal } from "../../hooks/useTerminal";
import { invoke } from "@tauri-apps/api/core";
import { XTermView, clearTerminalState } from "./XTermView";
import { AgentPanelHeader } from "./AgentPanelHeader";
import ChatView from "../chat/ChatView";
import { History } from "lucide-react";
import { startFork } from "../../lib/forkActions";
import CheckpointTimeline from "../checkpoints/CheckpointTimeline";
import {
  ThinkingModeSelector,
  type ThinkingMode,
} from "../chat/ThinkingModeSelector";

const CLAUDE_MODELS = ["sonnet", "opus", "fable", "haiku"];
const statusColors: Record<string, string> = {
  starting: "#ffd43b",
  running: "#51cf66",
  stopped: "#a0a0a0",
  error: "#ff6b6b",
};

export function TerminalPanel({ instanceId }: { instanceId: string }) {
  const provider = useInstanceStore(
    (s) => s.instances.get(instanceId)?.config.agentProvider,
  );
  return provider === "codex" ? (
    <CodexPanel instanceId={instanceId} />
  ) : (
    <ClaudeTerminalPanel instanceId={instanceId} />
  );
}
function ClaudeTerminalPanel({ instanceId }: { instanceId: string }) {
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const panelView = instance?.config?.panelView ?? "chat";
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const [restarting, setRestarting] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>("auto");

  useEffect(() => {
    if (!instance) useLayoutStore.getState().removePanel(instanceId);
  }, [instance, instanceId]);
  useEffect(() => {
    if (panelView !== "terminal") return;
    return useEventBusStore
      .getState()
      .subscribe("panel:restart", instanceId, (data) => {
        if (
          (data as { instanceId?: string } | undefined)?.instanceId ===
          instanceId
        )
          setRestartKey((k) => k + 1);
      });
  }, [instanceId, panelView]);
  const handleRestart = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      await restartPty(instanceId);
      setRestartKey((k) => k + 1);
    } finally {
      setRestarting(false);
    }
  }, [instanceId, restarting]);
  const handleClose = useCallback(async () => {
    clearTerminalState(instanceId);
    cleanupPty(instanceId);
    destroyTerminal(instanceId);
    try {
      await invoke("pty_kill", { id: instanceId });
    } catch {
      /* already stopped */
    }
    try {
      await invoke("stream_kill", { id: instanceId });
    } catch {
      /* already stopped */
    }
    useLayoutStore.getState().removePanel(instanceId);
    useInstanceStore.getState().removeInstance(instanceId);
  }, [instanceId]);
  if (!instance) return null;
  return (
    <div
      className="terminal-panel"
      style={{ borderTop: `2px solid ${instance.color}` }}
    >
      <AgentPanelHeader
        instanceId={instanceId}
        status={instance.status}
        statusColor={statusColors[instance.status] ?? "#a0a0a0"}
        metadata={`Claude · ${instance.config.model || "default"}${panelView === "chat" ? ` · ${thinkingMode.replaceAll("_", " ")}` : ""}`}
        onClose={() => void handleClose()}
        onFork={() => void startFork(instanceId)}
        onRestart={
          panelView === "terminal" ? () => void handleRestart() : undefined
        }
        restarting={restarting}
        controls={
          panelView === "chat" ? (
            <>
              <div className="toolbar-menu-row">
                <select
                  className="model-selector"
                  aria-label="Claude model"
                  value={instance.config.model}
                  title="Change model (applies to next message)"
                  onChange={(event) => {
                    useInstanceStore
                      .getState()
                      .setModel(instanceId, event.target.value);
                    invoke("stream_set_model", {
                      id: instanceId,
                      model: event.target.value,
                    }).catch(() => {});
                  }}
                >
                  {!CLAUDE_MODELS.includes(instance.config.model) && (
                    <option value={instance.config.model}>
                      {instance.config.model}
                    </option>
                  )}
                  {CLAUDE_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <ThinkingModeSelector
                  instanceId={instanceId}
                  value={thinkingMode}
                  onChange={setThinkingMode}
                />
              </div>
              <div className="toolbar-menu-row">
                <button
                  className="toolbar-btn"
                  title="Checkpoints"
                  onClick={() => setShowCheckpoints((value) => !value)}
                  style={{
                    color: showCheckpoints ? "var(--accent)" : undefined,
                  }}
                >
                  <History size={14} />
                </button>
                <span>Checkpoints</span>
              </div>
            </>
          ) : undefined
        }
      />
      {/* Content area: one fixed view per panel (chosen at creation) */}
      <div className="terminal-content" style={{ display: "flex" }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <div className="view-layer visible">
            {panelView === "chat" ? (
              <ChatView instanceId={instanceId} isVisible />
            ) : (
              // restartKey remounts the view after the process is killed, so
              // the fresh terminal fits and spawns from scratch.
              <XTermView key={restartKey} instanceId={instanceId} isVisible />
            )}
          </div>
        </div>

        {/* Checkpoint sidebar panel */}
        {showCheckpoints && (
          <div
            style={{
              width: 280,
              flexShrink: 0,
              borderLeft: "1px solid var(--border)",
              background: "var(--bg-surface)",
              overflow: "hidden",
            }}
          >
            <CheckpointTimeline instanceId={instanceId} />
          </div>
        )}
      </div>
    </div>
  );
}
