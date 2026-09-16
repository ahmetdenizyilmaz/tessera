import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInstanceStore } from "../../store/instanceStore";
import { useCodexStore } from "../../store/codexStore";
import { ensureCodex } from "../../lib/codexBridge";
import {
  findCodexPanel,
  focusCodexPanel,
  restartCodex,
} from "../../lib/codexSessions";
import { closePanel } from "../../lib/panelCleanup";

import { XTermView } from "../terminal/XTermView";
import { MarkdownRenderer } from "../chat/MarkdownRenderer";
import { ProviderIcon } from "../icons/ProviderIcons";
import { CodexRequests } from "./CodexRequests";
import { CodexHistory } from "./CodexHistory";
import { CodexPermissionSelect } from "./CodexPermissionSelect";
import { codexPermissionMode, codexPermissions } from "../../lib/codexPermissions";
import { AgentPanelHeader } from "../terminal/AgentPanelHeader";
import { ImageAttachmentButton } from "../chat/ImageAttachmentButton";
import { ImageChip } from "../chat/ImageChip";
import type { CodexDiscovery, CodexItem } from "../../types/codex";
import { markForkConsumed, peekForkContext, startFork, submitForkOpeningToTerminal, takeForkOpeningMessage } from "../../lib/forkActions";
import { stripForkPreamble } from "../../lib/forkTranscript";
import { ForkNotice } from "../chat/ForkNotice";
import { Loader2 } from "lucide-react";

function ItemView({ item }: { item: CodexItem }) {
  if (item.type === "userMessage")
    return (
      <article className="msg msg--user codex-message-user">
        <div className="msg-header msg-header--user">
          <span className="msg-label">You</span>
        </div>
        <div className="msg-body msg-body--user">
          {item.content?.map((c, i) =>
            c.type === "text" ? (
              <p className="msg-user-text" key={i}>
                {stripForkPreamble(c.text ?? "")}
              </p>
            ) : c.type === "image" && c.url?.startsWith("data:image/") ? (
              <img
                className="codex-attachment"
                key={i}
                src={c.url}
                alt="Attached"
              />
            ) : null,
          )}
        </div>
      </article>
    );
  if (item.type === "agentMessage")
    return (
      <article className="msg msg--assistant codex-message">
        <div className="msg-header">
          <ProviderIcon provider="openai" size={14} />
          <span className="msg-label">Codex</span>
        </div>
        <div className="msg-body">
          <MarkdownRenderer content={item.text ?? ""} />
        </div>
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
    [images, setImages] = useState<string[]>([]);
  const [models, setModels] = useState<CodexDiscovery["models"]>([]);
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const requestArea = useRef<HTMLDivElement>(null);
  const [requestsExpanded, setRequestsExpanded] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [attaching, setAttaching] = useState(false);
  const [recoverHistory, setRecoverHistory] = useState(false);
  const follow = useRef(true);
  const isTerminal = instance?.config.panelView === "terminal";
  const terminalAttached = isTerminal && session?.materialized;
  const model = models.find((m) => m.model === instance?.config.model);
  const missingThread =
    !!instance?.codexThreadId &&
    !!session?.error?.includes(
      `no rollout found for thread id ${instance.codexThreadId}`,
    );
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
  useEffect(() => {
    if (!session?.requests.length) setRequestsExpanded(false);
  }, [session?.requests.length]);
  // A forked Codex terminal has no first turn yet, and the TUI can only attach
  // once one exists. Send the inherited conversation as that first turn so the
  // terminal opens right away with the history visible.
  const forkBootstrapped = useRef(false);
  const forkPending = !!instance?.config.fork?.pending;
  // Between the fork's first turn and the terminal attaching, the panel shows
  // an "opening" state instead of the chat composer.
  const openingTerminal = isTerminal && !terminalAttached && !!instance?.config.fork && (forkPending || forkBootstrapped.current);
  useEffect(() => {
    if (!isTerminal || terminalAttached || !ready || !session?.connected || session?.busy || pending) return;
    if (forkBootstrapped.current || !forkPending) return;
    const context = peekForkContext(instanceId);
    if (!context) return;
    forkBootstrapped.current = true;
    setPending(true);
    invoke("codex_send", {
      id: instanceId,
      text: `${context}\n\nThe conversation above was forked from another panel. Reply with one short line confirming you have this context, then wait for the next instruction.`,
      images: [],
      model: instance?.config.model || null,
      effort: instance?.config.codex?.effort || null,
    })
      .then(() => markForkConsumed(instanceId))
      .catch(error)
      .finally(() => setPending(false));
  }, [isTerminal, terminalAttached, ready, session?.connected, session?.busy, pending, forkPending, instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening message of a fork: chat panels send it through the app-server once
  // the resumed thread is on screen; terminal panels paste it into the TUI.
  const forkOpening = instance?.config.fork?.openingMessage;
  useEffect(() => {
    if (!forkOpening || !ready || !session?.connected || session?.busy || pending) return;
    if (terminalAttached) {
      submitForkOpeningToTerminal(instanceId);
      return;
    }
    if (isTerminal || !session?.items.length) return;
    const text = takeForkOpeningMessage(instanceId);
    if (!text) return;
    setPending(true);
    invoke("codex_send", {
      id: instanceId,
      text,
      images: [],
      model: instance?.config.model || null,
      effort: instance?.config.codex?.effort || null,
    })
      .catch(error)
      .finally(() => setPending(false));
  }, [forkOpening, ready, session?.connected, session?.busy, session?.items.length, pending, terminalAttached, isTerminal, instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const restart = async (fresh = false, threadId?: string, cwd?: string) => {
    if (pending || session?.busy) return;
    setPending(true);
    setReady(false);
    try {
      await restartCodex(instanceId, fresh, threadId, cwd);
      setRestartKey((k) => k + 1);
      setRecoverHistory(false);
      setReady(true);
    } catch (e) {
      error(e);
    } finally {
      setPending(false);
    }
  };
  const send = async () => {
    if (
      (!text.trim() && !images.length) ||
      pending ||
      attaching ||
      !ready ||
      !session?.connected ||
      session?.busy ||
      session?.requests.length
    )
      return;
    const focusedBeforeSend = document.activeElement;
    setPending(true);
    useCodexStore.getState().setError(instanceId, undefined);
    // A forked panel attaches the inherited conversation to its first message.
    const forkContext = text.trim().startsWith("/") ? null : peekForkContext(instanceId);
    try {
      await invoke("codex_send", {
        id: instanceId,
        text: forkContext ? `${forkContext}\n\n${text}` : text,
        images,
        model: instance?.config.model || null,
        effort: instance?.config.codex?.effort || null,
      });
      if (forkContext) markForkConsumed(instanceId);
      setText("");
      setImages([]);
      if (composer.current) composer.current.style.height = "40px";
      if (document.activeElement === focusedBeforeSend)
        composer.current?.focus({ preventScroll: true });
      follow.current = true;
    } catch (e) {
      error(e);
    } finally {
      setPending(false);
    }
  };
  const attach = async (files: File[]) => {
    setAttaching(true);
    try {
      if (files.length + images.length > 8)
        throw new Error("Attach up to 8 images per message.");
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
      useCodexStore.getState().setError(instanceId, undefined);
    } catch (e) {
      error(e);
    } finally {
      setAttaching(false);
    }
  };
  const canSend =
    ready &&
    !!session?.connected &&
    !pending &&
    !attaching &&
    !session?.busy &&
    !session?.requests.length &&
    (!!text.trim() || images.length > 0);
  const showRequests = () => {
    setRequestsExpanded(true);
    requestAnimationFrame(() => {
      requestArea.current?.scrollTo({ top: 0 });
      requestArea.current?.querySelector<HTMLElement>(".codex-request")?.focus({ preventScroll: true });
    });
  };
  const returnToInput = () => {
    setRequestsExpanded(false);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLTextAreaElement>(
      ".xterm-helper-textarea, .chat-textarea",
    )?.focus({ preventScroll: true }));
  };
  const requests = !!session?.requests.length && (
    <div ref={requestArea} className={`codex-requests${requestsExpanded ? " codex-requests--expanded" : ""}`}>
      <div className="codex-request-toolbar">
        <button type="button" className="control-btn control-btn--neutral"
          aria-expanded={requestsExpanded}
          onClick={requestsExpanded ? returnToInput : showRequests}>
          {requestsExpanded ? "Back to input · Esc" : `Questions & approvals (${session.requests.length}) · Alt+↑`}
        </button>
      </div>
      <CodexRequests requests={session.requests} instanceId={instanceId} />
    </div>
  );
  if (!instance) return null;
  return (
    <section
      ref={panel}
      className="terminal-panel codex-panel"
      style={{ borderTopColor: instance.color }}
      onKeyDownCapture={(event) => {
        if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowUp" && session?.requests.length) {
          event.preventDefault();
          event.stopPropagation();
          showRequests();
        } else if (requestsExpanded && requestArea.current?.contains(event.target as Node) &&
          (event.key === "Escape" || (event.altKey && event.key === "ArrowDown"))) {
          event.preventDefault();
          event.stopPropagation();
          returnToInput();
        }
      }}
    >
      <AgentPanelHeader
        instanceId={instanceId}
        status={
          session?.requests.length
            ? "Needs input"
            : session?.busy
              ? "Working"
              : terminalAttached && instance.status === "stopped"
                ? "Terminal stopped"
                : ready && session?.connected
                  ? "Ready"
                  : "Stopped"
        }
        statusColor={
          session?.error
            ? "#ff6b6b"
            : session?.busy || session?.requests.length
              ? "#ffd43b"
              : ready && session?.connected
                ? "#51cf66"
                : "#a0a0a0"
        }
        metadata={`Codex · ${instance.config.model || "default"} · ${instance.config.codex?.effort || "default effort"}`}
        onClose={() => void closePanel(instanceId)}
        onFork={() => void startFork(instanceId)}
        onRestart={() => void restart()}
        restarting={pending || session?.busy}
        onStop={
          session?.busy
            ? () => {
                void invoke("codex_interrupt", { id: instanceId }).catch(error);
              }
            : undefined
        }
        controls={
          <>
            {!isTerminal && (
              <div className="toolbar-menu-row codex-model-controls">
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
              </div>
            )}
            <small>{instance.config.cwd}</small>
            <CodexPermissionSelect
              value={codexPermissionMode(instance.config.codex)}
              disabled={pending || session?.busy || !!session?.requests.length}
              onChange={(mode) => {
                if (pending || session?.busy || session?.requests.length) return;
                useInstanceStore.getState().updateInstance(instanceId, {
                  config: {
                    ...instance.config,
                    codex: { ...instance.config.codex, ...codexPermissions(mode) },
                  },
                });
                void restart();
              }}
            />
            <small>Changing permissions reconnects this conversation.</small>
            {isTerminal && (
              <small>
                Change model and effort with /model in the terminal.
              </small>
            )}
            {session?.usage && (
              <details>
                <summary>Token usage</summary>
                <pre>{JSON.stringify(session.usage, null, 2)}</pre>
              </details>
            )}
          </>
        }
      />
      {session?.error && (
        <div role="alert" className="codex-error">
          {missingThread ? (
            <>
              <strong>This saved conversation has no transcript.</strong>
              <p>
                An earlier Tessera version could save an empty Codex panel as
                resumable. If this panel had messages, look for the conversation
                in saved history before starting a new one.
              </p>
              <details>
                <summary>Conversation ID</summary>
                {instance.codexThreadId}
              </details>
              <div className="codex-recovery-actions">
                <button
                  className="btn btn-secondary"
                  disabled={pending}
                  onClick={() => setRecoverHistory((value) => !value)}
                >
                  {recoverHistory
                    ? "Hide saved conversations"
                    : "Find saved conversation"}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={pending}
                  onClick={() => void restart(true)}
                >
                  Start a new conversation
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={pending}
                  onClick={() => void restart()}
                >
                  Retry resume
                </button>
              </div>
            </>
          ) : (
            <>
              {session.error}
              {(!ready || !session.connected) && (
                <button onClick={() => void restart()} disabled={pending}>
                  Retry / resume
                </button>
              )}
            </>
          )}
        </div>
      )}
      {missingThread && recoverHistory && (
        <CodexHistory
          executablePath={instance.config.codex?.executablePath}
          currentThreadId={instance.codexThreadId}
          disabled={pending}
          onSelect={(thread) => {
            const open = findCodexPanel(thread.id);
            if (open && open !== instanceId) focusCodexPanel(open);
            else void restart(false, thread.id, thread.cwd);
          }}
        />
      )}
      {terminalAttached ? (
        <div className="codex-terminal">
          {ready && (
            <XTermView key={restartKey} instanceId={instanceId} isVisible />
          )}
          {requests}
        </div>
      ) : openingTerminal ? (
        <div className="codex-transcript codex-fork-opening">
          <Loader2 size={18} className="spin" />
          <p className="codex-empty">
            Opening the Codex terminal with the conversation forked from{" "}
            {instance.config.fork?.sourceName}…
          </p>
          <p className="codex-empty" style={{ fontSize: 11, opacity: 0.7 }}>
            {session?.error ? session.error : "Codex reads the earlier turns first; the terminal attaches as soon as it answers."}
          </p>
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
            {!!instance.config.fork?.pending && !!instance.config.fork.transcript.length && (
              <details className="codex-tool fork-context" open={!session?.items.length}>
                <summary>
                  Forked from {instance.config.fork.sourceName} · {instance.config.fork.transcript.length} earlier message
                  {instance.config.fork.transcript.length === 1 ? "" : "s"}
                </summary>
                {instance.config.fork.transcript.map((m, i) => (
                  <article key={i} className={m.role === "user" ? "msg msg--user codex-message-user" : "msg msg--assistant codex-message"}>
                    <div className={m.role === "user" ? "msg-header msg-header--user" : "msg-header"}>
                      <span className="msg-label">{m.role === "user" ? "You" : instance.config.fork?.sourceProvider ?? "Assistant"}</span>
                    </div>
                    <div className={m.role === "user" ? "msg-body msg-body--user" : "msg-body"}>
                      {m.role === "user" ? <p className="msg-user-text">{m.content}</p> : <MarkdownRenderer content={m.content} />}
                    </div>
                  </article>
                ))}
              </details>
            )}
            {session?.items.map((item) => (
              <ItemView key={item.id} item={item} />
            ))}
            {!session?.items.length && !instance.config.fork?.pending && (
              <p className="codex-empty">
                {ready
                  ? isTerminal
                    ? "Send your first message to open this conversation in the Codex terminal."
                    : "Ask Codex to work in this project."
                  : session?.error
                    ? "Reconnect this panel to continue."
                    : "Connecting to Codex…"}
              </p>
            )}
          </div>
        </>
      )}
      {!terminalAttached && !openingTerminal && requests}
      {!terminalAttached && !openingTerminal && <ForkNotice instanceId={instanceId} />}
      {!terminalAttached && !openingTerminal && (
        <footer className="chat-input-area codex-input">
          {!!images.length && (
            <div className="image-chips">
              {images.map((img, i) => (
                <ImageChip
                  key={i}
                  src={img}
                  name={`Image ${i + 1}`}
                  onRemove={() =>
                    setImages((old) => old.filter((_, index) => i !== index))
                  }
                />
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <ImageAttachmentButton
              remaining={Math.max(0, 8 - images.length)}
              disabled={attaching}
              onLoadingChange={setAttaching}
              onError={error}
              onAttach={(picked) => {
                if (
                  model?.inputModalities &&
                  !model.inputModalities.includes("image")
                )
                  throw new Error("The selected model does not accept images.");
                setImages((old) => [
                  ...old,
                  ...picked.map((image) => image.dataUrl),
                ]);
                useCodexStore.getState().setError(instanceId, undefined);
                composer.current?.focus({ preventScroll: true });
              }}
            />
            <textarea
              ref={composer}
              className="chat-textarea"
              rows={1}
              aria-label="Message Codex"
              placeholder="Message Codex… (Enter to send, Shift+Enter for a new line)"
              value={text}
              disabled={!ready || !session?.connected}
              onChange={(event) => setText(event.target.value)}
              onInput={(event) => {
                const el = event.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(180, Math.max(40, el.scrollHeight))}px`;
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter(
                  (file) => file.type.startsWith("image/"),
                );
                if (files.length) {
                  event.preventDefault();
                  void attach(files);
                }
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className={`chat-send-btn ${canSend ? "chat-send-btn--active" : ""}`}
              aria-label="Send"
              title="Send (Enter)"
              disabled={!canSend}
              onClick={() => void send()}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2 8L14 2L8 14L7 9L2 8Z"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          {attaching && (
            <div className="chat-input-saving">Loading images…</div>
          )}
        </footer>
      )}
    </section>
  );
}
