import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useInstanceStore } from '../../store/instanceStore';
import { useStreamJson } from '../../hooks/useStreamJson';
import { useCheckpointStore } from '../../store/checkpointStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useChatStore } from '../../store/chatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ControlRequestArea } from './ControlRequestArea';
import { isUserMessage } from '../../types/stream';
import { ClaudeIcon } from '../icons/ProviderIcons';
import { isPtySpawned } from '../../hooks/usePty';
import type { SessionInfo } from '../../types/session';

// ---- Constants ----
const SESSION_SCAN_DELAY_MS = 2500;
const SESSION_SCAN_RETRY_MS = 3000;
const SESSION_SCAN_MAX_RETRIES = 5;

// ---- Component ----

interface ChatViewProps {
  instanceId: string;
  isVisible: boolean;
}

const ChatView: React.FC<ChatViewProps> = ({ instanceId, isVisible }) => {
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const accentColor = instance?.color ?? '#4a9eff';
  const projectDir = instance?.config?.cwd ?? '';
  const claudeSessionId = instance?.claudeSessionId;
  const { autoCheckpoint, createCheckpoint } = useCheckpointStore();

  // Focus tracking — hide input in unfocused panels when multiple panels exist
  const focusedId = useLayoutStore((s) => s.focusedId);
  const tabCount = useLayoutStore((s) => s.tabOrder.length);
  const isFocused = tabCount <= 1 || focusedId === instanceId;

  // Stream-JSON pipeline
  const {
    messages,
    isStreaming,
    controlRequests,
    systemInfo,
    error,
    spawn,
    send,
    respondControl,
    cancel,
  } = useStreamJson(instanceId);

  // ---- State ----
  const [isReady, setIsReady] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);
  const [spawnAttempted, setSpawnAttempted] = useState(false);

  // ---- Refs ----
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);
  // After /clear, block the session rescan from resurrecting the old session
  const clearedRef = useRef(false);
  const autoCheckpointRef = useRef(autoCheckpoint);
  const prevStreamingRef = useRef(false);
  autoCheckpointRef.current = autoCheckpoint;

  const SCROLL_THRESHOLD = 150;

  // ---- Register config with the persistent-process pipeline ----
  // stream_configure is idempotent and never touches a running process, so a
  // remount (e.g. group move) is safe — the transcript and process survive.
  useEffect(() => {
    if (spawnAttempted) return;

    // If no project dir, mark ready immediately so user can still see the input
    if (!projectDir) {
      setIsReady(true);
      return;
    }

    setSpawnAttempted(true);

    const model = instance?.config?.model;
    const systemPrompt = instance?.config?.systemPrompt;

    spawn(projectDir, {
      model: model || undefined,
      systemPrompt: systemPrompt || undefined,
      sessionId: claudeSessionId || undefined,
      permissionMode: instance?.config?.permissionMode || undefined,
      allowedTools: instance?.config?.allowedTools,
      dangerouslySkipPermissions: instance?.config?.dangerouslySkipPermissions ?? false,
    })
      .then(() => setIsReady(true))
      .catch((err) => {
        console.error(`[ChatView ${instanceId}] configure failed:`, err);
        setIsReady(true); // Still allow input even on failure
      });
  }, [instanceId, projectDir, claudeSessionId, instance, spawn, spawnAttempted]);

  // ---- Capture the session id from every init event ----
  useEffect(() => {
    if (systemInfo?.subtype === 'init') {
      setIsReady(true);
      // The chat process is alive — reflect it in the status badge (the
      // terminal path sets this on PTY spawn, but chat-only panels never
      // spawn a PTY anymore)
      const inst = useInstanceStore.getState().instances.get(instanceId);
      if (inst && inst.status !== 'running') {
        useInstanceStore.getState().setStatus(instanceId, 'running');
      }
      const sid = systemInfo.session_id;
      if (sid) {
        const cur = useInstanceStore.getState().instances.get(instanceId)?.claudeSessionId;
        if (cur !== sid) {
          useInstanceStore.getState().setClaudeSessionId(instanceId, sid);
        }
        // A fresh init means any prior /clear is complete
        clearedRef.current = false;
      }
    }
  }, [systemInfo, instanceId]);


  // ---- Auto-checkpoint after response completion ----
  useEffect(() => {
    // Trigger checkpoint when streaming stops (was streaming, now isn't)
    if (prevStreamingRef.current && !isStreaming && autoCheckpointRef.current) {
      const snapshot = JSON.stringify(
        messages.map((m) => {
          if ('blocks' in m) {
            return { role: m.role, blocks: m.blocks.map((b) => b.type === 'text' ? b.text : b.type) };
          }
          return { role: m.role, text: 'text' in m ? m.text : '' };
        })
      );
      const label = `Auto: ${messages.length} messages`;
      createCheckpoint(instanceId, claudeSessionId ?? '', label, snapshot).catch(() => {});
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, messages, instanceId, claudeSessionId, createCheckpoint]);

  // ---- Restore the visible transcript from the session file on reopen ----
  // The workspace restore brings back the panel + session id; the CLI resumes
  // the conversation context — this brings back the chat the user can SEE.
  useEffect(() => {
    if (!claudeSessionId || !projectDir) return;
    if (clearedRef.current) return;
    const session = useChatStore.getState().sessions.get(instanceId);
    if (session && session.messages.length > 0) return;
    let mounted = true;
    invoke<Array<{ role: string; content: string; timestamp?: string | null }>>('session_load_history', {
      sessionId: claudeSessionId,
      projectPath: projectDir,
    })
      .then((items) => {
        if (!mounted || !items || items.length === 0) return;
        useChatStore.getState().seedHistory(instanceId, items);
      })
      .catch(() => {
        // No session file yet (fresh session) — nothing to restore
      });
    return () => { mounted = false; };
  }, [instanceId, claudeSessionId, projectDir]);

  // ---- Session scan (for --resume detection) ----
  useEffect(() => {
    if (!projectDir) return;

    const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    let scanAttempts = 0;
    let mounted = true;

    const tryScan = () => {
      if (!mounted) return;
      // Never resurrect a session the user just cleared
      if (clearedRef.current) return;
      const inst = useInstanceStore.getState().instances.get(instanceId);
      if (!inst) return;
      // Only capture a session id when this instance has NONE — never
      // overwrite a deliberately chosen or already-captured session.
      if (inst.claudeSessionId) return;
      // Only the interactive Terminal flow creates sessions we can't see —
      // the chat pipeline reports its session id in every init event. Without
      // this gate a brand-new chat adopts the newest OLD session of its
      // directory (and then renders that old transcript).
      if (!isPtySpawned(instanceId)) {
        setTimeout(tryScan, SESSION_SCAN_RETRY_MS);
        return;
      }
      const cwd = inst.config.cwd;
      if (!cwd) return;
      scanAttempts++;

      invoke<SessionInfo[]>('session_scan_all')
        .then((sessions) => {
          if (!mounted) return;
          const current = useInstanceStore.getState().instances.get(instanceId)?.claudeSessionId;
          if (current) return;
          const cwdNorm = normPath(cwd);
          const match = sessions
            .filter((s) => normPath(s.project) === cwdNorm && s.hasFile)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
          if (match) {
            useInstanceStore.getState().setClaudeSessionId(instanceId, match.sessionId);
          } else if (scanAttempts < SESSION_SCAN_MAX_RETRIES) {
            setTimeout(tryScan, SESSION_SCAN_RETRY_MS);
          }
        })
        .catch(() => {
          if (scanAttempts < SESSION_SCAN_MAX_RETRIES && mounted) {
            setTimeout(tryScan, SESSION_SCAN_RETRY_MS);
          }
        });
    };

    const timer = setTimeout(tryScan, SESSION_SCAN_DELAY_MS);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [instanceId, projectDir]);

  // ---- Auto-scroll ----
  useEffect(() => {
    if (messages.length === 0) return;
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      });
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (dist < SCROLL_THRESHOLD) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const distFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
    setShowScrollBtn(distFromBottom > SCROLL_THRESHOLD);
    setShowScrollTopBtn(c.scrollTop > SCROLL_THRESHOLD);
  }, []);

  // ---- Keyboard scroll shortcuts ----
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const c = containerRef.current;
    if (!c) return;
    const pageSize = c.clientHeight * 0.85;

    switch (e.key) {
      case 'PageDown':
        e.preventDefault();
        c.scrollBy({ top: pageSize, behavior: 'smooth' });
        break;
      case 'PageUp':
        e.preventDefault();
        c.scrollBy({ top: -pageSize, behavior: 'smooth' });
        break;
      case 'Home':
        if (e.ctrlKey) {
          e.preventDefault();
          c.scrollTo({ top: 0, behavior: 'smooth' });
        }
        break;
      case 'End':
        if (e.ctrlKey) {
          e.preventDefault();
          c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
        }
        break;
    }
  }, []);

  // Stream exit is handled by useStreamJson (sets isStreaming=false)

  // ---- Send message ----
  const handleSend = useCallback(
    (messageText: string, images?: string[]) => {
      const trimmed = messageText.trim();
      if (!trimmed && (!images || images.length === 0)) return;

      // /clear — real clear: end the CLI process (its context dies with it),
      // wipe the transcript, and forget the session id. The next send starts
      // a brand-new conversation via the lazy spawn.
      if (trimmed === '/clear') {
        clearedRef.current = true;
        invoke('stream_clear', { id: instanceId }).catch(() => {});
        useChatStore.getState().reset(instanceId);
        useInstanceStore.getState().setClaudeSessionId(instanceId, '');
        return;
      }

      // All other input — including slash commands — goes to the CLI. The
      // user's message always appears in the transcript, and the CLI's own
      // reply/error renders via the result path.
      send(trimmed, images);
    },
    [send, instanceId],
  );

  // ---- Detect consecutive assistant message groups ----
  // isContinuation[i] = true if messages[i] is an assistant message preceded by another assistant
  // isGroupEnd[i] = true if messages[i] is the last assistant message before a non-assistant one
  const groupFlags = useMemo(() => {
    const flags: { isContinuation: boolean; isGroupEnd: boolean }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const isAssistant = !isUserMessage(messages[i]);
      const prevIsAssistant = i > 0 && !isUserMessage(messages[i - 1]);
      const nextIsAssistant = i + 1 < messages.length && !isUserMessage(messages[i + 1]);
      flags.push({
        isContinuation: isAssistant && prevIsAssistant,
        isGroupEnd: isAssistant && !nextIsAssistant,
      });
    }
    return flags;
  }, [messages]);

  // ---- Virtualizer for very large message lists ----
  // Threshold raised to 500: tool_use messages create many small messages
  // and the virtualizer's absolute positioning causes overlapping at lower counts.
  const useVirtual = messages.length > 500;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 300,
    overscan: 20,
    enabled: useVirtual,
  });

  // Auto-scroll for virtualizer
  useEffect(() => {
    if (!useVirtual || messages.length === 0) return;
    if (isStreaming || !showScrollBtn) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'smooth' });
    }
  }, [messages.length, useVirtual, isStreaming, showScrollBtn, virtualizer]);

  // ---- Render ----
  return (
    <div className="chat-view">
      <div className="chat-messages" ref={containerRef} onScroll={handleScroll} onKeyDown={handleKeyDown} tabIndex={0}>
        {/* Waiting for stream init */}
        {!isReady && messages.length === 0 && (
          <div className="chat-empty-state">
            <div className="chat-empty-icon" style={{ color: accentColor }}>
              <ClaudeIcon size={36} />
            </div>
            <div className="chat-empty-title">Starting Claude...</div>
            <div className="chat-empty-subtitle">Waiting for Claude Code to initialize</div>
          </div>
        )}

        {/* Ready, no messages */}
        {isReady && messages.length === 0 && !error && (
          <div className="chat-empty-state">
            <div className="chat-empty-icon chat-empty-icon--ready" style={{ color: accentColor }}>
              <ClaudeIcon size={36} />
            </div>
            {projectDir ? (
              <>
                <div className="chat-empty-title">Claude is ready</div>
                <div className="chat-empty-subtitle">
                  Type a message &middot; Paste images with Ctrl+V
                </div>
              </>
            ) : (
              <>
                <div className="chat-empty-title">No project selected</div>
                <div className="chat-empty-subtitle">
                  Select a project from the sidebar to start chatting with Claude
                </div>
              </>
            )}
          </div>
        )}

        {/* Error display \u2014 dismissible; also auto-cleared on the next send */}
        {error && (
          <div className="chat-error-banner">
            <span className="chat-error-icon">{'\u26A0'}</span>
            <span>{error}</span>
            <button
              className="chat-error-dismiss"
              title="Dismiss"
              onClick={() => useChatStore.getState().clearError(instanceId)}
            >
              {'\u00D7'}
            </button>
          </div>
        )}

        {/* Messages - virtualized for large lists, regular for small */}
        {useVirtual ? (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              const flags = groupFlags[virtualRow.index];
              return (
                <div
                  key={msg.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ChatMessage
                    message={msg}
                    isLast={virtualRow.index === messages.length - 1}
                    isContinuation={flags?.isContinuation}
                    isGroupEnd={flags?.isGroupEnd}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              isLast={i === messages.length - 1}
              isContinuation={groupFlags[i]?.isContinuation}
              isGroupEnd={groupFlags[i]?.isGroupEnd}
            />
          ))
        )}

        {/* Interactive control requests: permissions, questions, plan approval */}
        <ControlRequestArea
          instanceId={instanceId}
          requests={controlRequests}
          respond={respondControl}
        />

        {/* Thinking/streaming indicator */}
        {isStreaming && controlRequests.length === 0 && (
          <div className="chat-thinking-indicator">
            <div className="chat-thinking-dot" />
            <span>Claude is thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll navigation buttons */}
      <div className="scroll-nav-buttons">
        {showScrollTopBtn && (
          <button
            className="scroll-nav-btn scroll-to-top-btn"
            onClick={() => {
              if (useVirtual) {
                virtualizer.scrollToIndex(0, { align: 'start' });
              } else {
                containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            title="Scroll to top (Ctrl+Home)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 9L7 4L12 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {showScrollBtn && (
          <button
            className="scroll-nav-btn scroll-to-bottom-btn"
            onClick={() => {
              if (useVirtual) {
                virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
              } else {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            title="Scroll to bottom (Ctrl+End)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 5L7 10L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Chat input — hidden in unfocused panels */}
      {isFocused && (
        <ChatInput
          instanceId={instanceId}
          isReady={isReady}
          isStreaming={isStreaming}
          onSend={handleSend}
        />
      )}
    </div>
  );
};

export { ChatView };
export default ChatView;
