import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInstanceStore } from "../../store/instanceStore";
import { useCodexStore } from "../../store/codexStore";
import { ensureCodex } from "../../lib/codexBridge";
import {
  restartCodex,
  findCodexPanel,
  focusCodexPanel,
} from "../../lib/codexSessions";
import { closePanel } from "../../lib/panelCleanup";
import { useLayoutStore } from "../../store/layoutStore";
import { XTermView } from "../terminal/XTermView";
import { MarkdownRenderer } from "../chat/MarkdownRenderer";
import { ProviderIcon } from "../icons/ProviderIcons";
import { CodexRequests } from "./CodexRequests";
import { CodexHistory } from "./CodexHistory";
import type { CodexDiscovery, CodexItem, CodexThread } from "../../types/codex";

function ItemView({ item }: { item: CodexItem }) {
  if (item.type === "userMessage")
    return (
      <article className="codex-message codex-message-user">
        <small>You</small>
        {item.content?.map((c, i) =>
          c.type === "text" ? (
            <p key={i}>{c.text}</p>
          ) : c.type === "image" && c.url?.startsWith("data:image/") ? (
            <img
              className="codex-attachment"
              key={i}
              src={c.url}
              alt="Attached"
            />
          ) : null,
        )}
      </article>
    );
  if (item.type === "agentMessage")
    return (
      <article className="codex-message">
        <small>Codex</small>
        <MarkdownRenderer content={item.text ?? ""} />
      </article>
    );
  if (item.type === "reasoning")
    return (
      <details className="codex-tool">
        <summary>Reasoning summary</summary>
        <MarkdownRenderer
          content={item.summary?.join("\n") || item.text || ""}
        />
      </details>
    );
  if (item.type === "commandExecution")
    return (
      <details className="codex-tool" open={item.status === "inProgress"}>
        <summary>Command · {item.status ?? "running"}</summary>
        <pre>{item.command}</pre>
        <pre>{item.aggregatedOutput}</pre>
      </details>
    );
  if (item.type === "fileChange")
    return (
      <details className="codex-tool" open>
        <summary>File changes · {item.status}</summary>
        {item.changes?.map((c, i) => (
          <div key={i}>
            <strong>{c.path}</strong>
            <pre>{c.diff}</pre>
          </div>
        ))}
      </details>
    );
  if (item.type === "plan")
    return (
      <article className="codex-message">
        <small>Plan</small>
        <MarkdownRenderer content={item.text ?? ""} />
      </article>
    );
  return (
    <details className="codex-tool">
      <summary>
        {item.type} {item.status ? "· " + item.status : ""}
      </summary>
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </details>
  );
}

export function CodexPanel({ instanceId }: { instanceId: string }) {
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const session = useCodexStore((s) => s.sessions[instanceId]);
  const [ready, setReady] = useState(false),
    [pending, setPending] = useState(false),
    [restartKey, setRestartKey] = useState(0);
  const [text, setText] = useState(""),
    [images, setImages] = useState<string[]>([]),
    [history, setHistory] = useState(false);
  const [models, setModels] = useState<CodexDiscovery["models"]>([]);
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const isTerminal = instance?.config.panelView === "terminal";
  const terminalAttached = isTerminal && session?.materialized;
  const model = models.find((m) => m.model === instance?.config.model);
  const error = (e: unknown) =>
    useCodexStore.getState().setError(instanceId, String(e));
  useEffect(() => {
    let active = true;
    ensureCodex(instanceId)
      .then(() => {
        if (active) setReady(true);
      })
      .catch(error);
    invoke<CodexDiscovery>("codex_discover", {
      executablePath: instance?.config.codex?.executablePath || null,
    })
      .then((d) => {
        if (active) setModels(d.models);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [instanceId]);
  useEffect(() => {
    if (follow.current && body.current)
      body.current.scrollTop = body.current.scrollHeight;
  }, [session?.items, session?.requests]);
  const restart = async (fresh = false, thread?: CodexThread) => {
    if (thread) {
      const holder = findCodexPanel(thread.id);
      if (holder && holder !== instanceId) {
        focusCodexPanel(holder);
        return;
      }
    }
    setPending(true);
    setReady(false);
    try {
      await restartCodex(instanceId, fresh, thread?.id, thread?.cwd);
      setRestartKey((k) => k + 1);
      setReady(true);
      setHistory(false);
    } catch (e) {
      error(e);
    } finally {
      setPending(false);
    }
  };
  const send = async () => {
    if (!text.trim() || pending || session?.busy) return;
    setPending(true);
    useCodexStore.getState().setError(instanceId, undefined);
    try {
      await invoke("codex_send", {
        id: instanceId,
        text,
        images,
        model: instance?.config.model || null,
        effort: instance?.config.codex?.effort || null,
      });
      setText("");
      setImages([]);
      follow.current = true;
    } catch (e) {
      error(e);
    } finally {
      setPending(false);
    }
  };
  const attach = async (files: File[]) => {
    try {
      if (model?.inputModalities && !model.inputModalities.includes("image"))
        throw new Error("The selected model does not accept images.");
      const data = await Promise.all(
        files.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              if (
                !file.type.startsWith("image/") ||
                file.size > 10 * 1024 * 1024
              ) {
                reject(new Error("Attach image files up to 10 MB each."));
                return;
              }
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("Cannot read image"));
              reader.readAsDataURL(file);
            }),
        ),
      );
      setImages((old) => [...old, ...data].slice(0, 8));
    } catch (e) {
      error(e);
    }
  };
  if (!instance) return null;
  return (
    <section className="codex-panel" style={{ borderTopColor: instance.color }}>
      <header className="codex-toolbar">
        <ProviderIcon provider="openai" size={18} />
        <input
          aria-label="Panel name"
          className="codex-name"
          value={instance.name}
          onChange={(e) =>
            useInstanceStore.getState().setName(instanceId, e.target.value)
          }
        />
        <input
          aria-label="Panel color"
          type="color"
          value={instance.color}
          onChange={(e) =>
            useInstanceStore.getState().setColor(instanceId, e.target.value)
          }
        />
        <span className="codex-status">
          {session?.requests.length
            ? "Needs input"
            : session?.busy
              ? "Working"
              : terminalAttached && instance.status === "stopped"
                ? "Terminal stopped"
              : ready && session?.connected
                ? "Ready"
                : "Stopped"}
        </span>
        {!isTerminal && (
          <>
            <select
              aria-label="Codex model"
              value={instance.config.model}
              disabled={pending || session?.busy}
              onChange={(e) => {
                const m = models.find((m) => m.model === e.target.value);
                useInstanceStore.getState().updateInstance(instanceId, {
                  config: {
                    ...instance.config,
                    model: e.target.value,
                    codex: {
                      ...instance.config.codex,
                      effort: m?.defaultReasoningEffort ?? "",
                    },
                  },
                });
              }}
            >
              {!models.some((m) => m.model === instance.config.model) && (
                <option value={instance.config.model}>
                  {instance.config.model || "Default model"}
                </option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.model}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <select
              aria-label="Reasoning effort"
              value={instance.config.codex?.effort ?? ""}
              disabled={pending || session?.busy}
              onChange={(e) =>
                useInstanceStore.getState().updateInstance(instanceId, {
                  config: {
                    ...instance.config,
                    codex: {
                      ...instance.config.codex,
                      effort: e.target.value,
                    },
                  },
                })
              }
            >
              {!model && (
                <option value={instance.config.codex?.effort ?? ""}>
                  Default effort
                </option>
              )}
              {model?.supportedReasoningEfforts.map((e) => (
                <option key={e.reasoningEffort} value={e.reasoningEffort}>
                  {e.reasoningEffort}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          title="Interrupt current turn"
          disabled={!session?.busy}
          onClick={() =>
            invoke("codex_interrupt", { id: instanceId }).catch(error)
          }
        >
          Stop
        </button>
        <button
          disabled={pending || session?.busy}
          onClick={() => setHistory((v) => !v)}
        >
          History
        </button>
        <button
          disabled={pending || session?.busy}
          onClick={() => void restart(true)}
        >
          New
        </button>
        <button
          disabled={pending || session?.busy}
          onClick={() => void restart()}
        >
          Restart
        </button>
        <button
          title="Maximize panel"
          onClick={() => useLayoutStore.getState().toggleMaximized(instanceId)}
        >
          ⤢
        </button>
        <button title="Close panel" onClick={() => void closePanel(instanceId)}>
          ×
        </button>
      </header>
      <div className="codex-project">
        {instance.config.cwd} ·{" "}
        {instance.config.codex?.sandbox ?? "workspace-write"}
        {isTerminal ? " · Change model/effort in the Codex terminal" : ""}
      </div>
      {session?.error && (
        <div role="alert" className="codex-error">
          {session.error}
          {!session.connected && (
            <button onClick={() => void restart()} disabled={pending}>
              Retry / resume
            </button>
          )}
        </div>
      )}
      {history && (
        <CodexHistory
          executablePath={instance.config.codex?.executablePath}
          currentThreadId={instance.codexThreadId}
          onSelect={(t) => void restart(false, t)}
        />
      )}
      {terminalAttached ? (
        <div className="codex-terminal">
          {ready && (
            <XTermView key={restartKey} instanceId={instanceId} isVisible />
          )}
        </div>
      ) : (
        <>
          <div
            className="codex-transcript"
            ref={body}
            onScroll={() => {
              const b = body.current;
              if (b)
                follow.current =
                  b.scrollHeight - b.scrollTop - b.clientHeight < 100;
            }}
          >
            {session?.items.map((item) => (
              <ItemView key={item.id} item={item} />
            ))}
            {!session?.items.length && (
              <p className="codex-empty">
                {ready
                  ? isTerminal
                    ? "Send your first message to open this conversation in the Codex terminal."
                    : "Ask Codex to work in this project."
                  : "Connecting to Codex…"}
              </p>
            )}
          </div>
        </>
      )}
      {!!session?.requests.length && (
        <div className="codex-requests">
          <CodexRequests requests={session.requests} instanceId={instanceId} />
        </div>
      )}
      {!terminalAttached && (
        <footer className="codex-input">
          {!!images.length && (
            <div className="form-row">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setImages((a) => a.filter((_, j) => i !== j))}
                  title="Remove image"
                >
                  <img
                    className="codex-attachment"
                    src={img}
                    alt={"Attachment " + (i + 1)}
                  />
                </button>
              ))}
            </div>
          )}
          <textarea
            aria-label="Message Codex"
            placeholder="Ask Codex… (Enter to send, Shift+Enter for a new line)"
            value={text}
            disabled={!ready || !session?.connected}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                void attach(files);
              }
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (!session?.requests.length) void send();
              }
            }}
          />
          <div className="form-row">
            <label className="btn btn-secondary">
              Attach images
              <input
                hidden
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  void attach(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            <button
              className="btn btn-primary"
              disabled={
                !ready ||
                !session?.connected ||
                pending ||
                session?.busy ||
                !!session?.requests.length ||
                !text.trim()
              }
              onClick={() => void send()}
            >
              Send
            </button>
            {session?.usage && (
              <details>
                <summary>Token usage</summary>
                <pre>{JSON.stringify(session.usage, null, 2)}</pre>
              </details>
            )}
          </div>
        </footer>
      )}
    </section>
  );
}
