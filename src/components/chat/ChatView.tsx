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
import { isUserMessage } from '../../types/stream';
import { ClaudeIcon } from '../icons/ProviderIcons';
import type { SessionInfo } from '../../types/session';

// ─── Module-level spawn tracking (survives unmount/remount for group moves) ──
// Prevents re-spawning (and re-initializing the session which clears messages)
// when a panel is moved to/from a group.

const spawnedStreams: Set<string> =
  (globalThis as Record<string, unknown>).__chatSpawnedStreams as Set<string> ??
  ((globalThis as Record<string, unknown>).__chatSpawnedStreams = new Set<string>());

/** Call on explicit panel close to allow re-spawn if instance is recreated */
export function clearChatSpawnState(instanceId: string) {
  spawnedStreams.delete(instanceId);
}

// All built-in Claude Code slash commands are interactive-only.
// In -p (print) mode the CLI treats /cmd as a skill lookup and returns
// "Unknown skill: cmd" for every built-in. Only user/project .md skills work.
const TERMINAL_ONLY_COMMANDS = new Set([
  '/help', '/compact', '/config', '/cost', '/usage',
  '/model', '/status', '/review', '/init', '/memory',
  '/permissions', '/doctor', '/bug', '/pr_comments',
  '/release-notes', '/vim', '/terminal-setup', '/login', '/logout',
]);

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
    permissionRequest,
    systemInfo,
    error,
    spawn,
    send,
    respondPermission,
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
  const autoCheckpointRef = useRef(autoCheckpoint);
  const prevStreamingRef = useRef(false);
  autoCheckpointRef.current = autoCheckpoint;

  const SCROLL_THRESHOLD = 150;

  // ---- Auto-spawn stream process ----
  useEffect(() => {
    if (spawnAttempted) return;

    // If already spawned (remount after group move), skip re-spawn to preserve
    // chat messages and the running CLI process
    if (spawnedStreams.has(instanceId)) {
      setSpawnAttempted(true);
      setIsReady(true);
      return;
    }

    // If no project dir, mark ready immediately so user can still see the input
    if (!projectDir) {
      setIsReady(true);
      return;
    }

    setSpawnAttempted(true);
    spawnedStreams.add(instanceId);

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
        console.error(`[ChatView ${instanceId}] spawn failed:`, err);
        spawnedStreams.delete(instanceId); // Allow retry on failure
        setIsReady(true); // Still allow input even on spawn failure
      });
  }, [instanceId, projectDir, claudeSessionId, instance, spawn, spawnAttempted]);

  // ---- Mark ready when system init event arrives ----
  useEffect(() => {
    if (systemInfo?.subtype === 'init') {
      setIsReady(true);
    }
  }, [systemInfo]);


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

  // ---- Session scan (for --resume detection) ----
  useEffect(() => {
    if (!projectDir) return;

    const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    let scanAttempts = 0;
    let mounted = true;

    const tryScan = () => {
      if (!mounted) return;
      const inst = useInstanceStore.getState().instances.get(instanceId);
      if (!inst) return;
      const cwd = inst.config.cwd;
      if (!cwd) return;
      scanAttempts++;

      invoke<SessionInfo[]>('session_scan_all')
        .then((sessions) => {
          if (!mounted) return;
          const cwdNorm = normPath(cwd);
          const match = sessions
            .filter((s) => normPath(s.project) === cwdNorm && s.hasFile)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
          if (match) {
            const current = useInstanceStore.getState().instances.get(instanceId)?.claudeSessionId;
            if (match.sessionId !== current) {
              useInstanceStore.getState().setClaudeSessionId(instanceId, match.sessionId);
            }
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
    (messageText: string) => {
      const trimmed = messageText.trim();
      if (!trimmed) return;

      // /clear — handled client-side: wipe messages and start a fresh session
      if (trimmed === '/clear') {
        useChatStore.getState().initSession(instanceId);
        useInstanceStore.getState().setClaudeSessionId(instanceId, '');
        setSpawnAttempted(false); // triggers useEffect to re-spawn with clean state
        return;
      }

      // Commands that only work in interactive (terminal) mode
      const cmd = trimmed.split(/\s/)[0].toLowerCase();
      if (TERMINAL_ONLY_COMMANDS.has(cmd)) {
        useChatStore.getState().processEvent(instanceId, {
          type: 'assistant',
          message: {
            id: `local-${Date.now()}`,
            role: 'assistant',
            model: '',
            content: [{
              type: 'text',
              text: `\`${cmd}\` only works in interactive mode. Switch to the **Terminal** tab to use it.`,
            }],
          },
        } as any);
        return;
      }

      send(trimmed);
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

        {/* Permission request banner */}
        {permissionRequest && (
          <div className="chat-permission-banner">
            <div className="permission-card">
              <div className="permission-card-title">
                <span className="permission-card-icon">{'\u{1F510}'}</span>
                <span>Permission: {permissionRequest.tool_name}</span>
              </div>
              {permissionRequest.description && (
                <div className="permission-card-lines">
                  <div className="permission-card-line">{permissionRequest.description}</div>
                </div>
              )}
              <pre className="permission-card-input">
                {JSON.stringify(permissionRequest.tool_input, null, 2)}
              </pre>
              <div className="permission-card-actions">
                <button
                  className="permission-btn permission-btn--allow"
                  onClick={() => respondPermission(true)}
                >
                  Allow
                </button>
                <button
                  className="permission-btn permission-btn--deny"
                  onClick={() => respondPermission(false)}
                >
                  Deny
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Thinking/streaming indicator */}
        {isStreaming && (
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
