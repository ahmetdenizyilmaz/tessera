import { useRef, useEffect, useCallback, useState } from 'react';
import { useLlmChat } from '../../hooks/useLlmChat';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { LLM_PROVIDERS } from '../../types/llmProviders';
import type { LlmProvider } from '../../types/instance';
import MarkdownRenderer from '../chat/MarkdownRenderer';
import { ProviderIcon } from '../icons/ProviderIcons';

interface LlmChatViewProps {
  instanceId: string;
}

export default function LlmChatView({ instanceId }: LlmChatViewProps) {
  const { messages, isStreaming, error, sendMessage, cancelStream } = useLlmChat(instanceId);
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const focusedId = useLayoutStore((s) => s.focusedId);
  const tabOrder = useLayoutStore((s) => s.tabOrder);
  const isFocused = focusedId === instanceId;
  const panelCount = tabOrder?.length ?? 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);

  const SCROLL_THRESHOLD = 150;

  const provider = instance?.config.llmConfig?.provider as Exclude<LlmProvider, 'claude'> | undefined;
  const providerMeta = provider ? LLM_PROVIDERS[provider] : null;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
    if (isNearBottom || isStreaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Track scroll position for scroll buttons
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > SCROLL_THRESHOLD);
    setShowScrollTopBtn(el.scrollTop > SCROLL_THRESHOLD);
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Keyboard scroll shortcuts
  const handleScrollKeyDown = useCallback((e: React.KeyboardEvent) => {
    const c = scrollRef.current;
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

  // Focus textarea when panel becomes focused
  useEffect(() => {
    if (isFocused && !isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isFocused, isStreaming]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Auto-grow textarea
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 40), 180) + 'px';
  }, []);

  const showInput = isFocused || panelCount <= 1;

  return (
    <div className="chat-view">
      <div className="chat-messages" ref={scrollRef} onScroll={handleScroll} onKeyDown={handleScrollKeyDown} tabIndex={0}>
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <div className="chat-empty-icon chat-empty-icon--ready" style={{ color: instance?.color ?? '#4a9eff' }}>
              <ProviderIcon provider={provider ?? 'openai'} size={36} />
            </div>
            <div className="chat-empty-title">
              {providerMeta
                ? `${providerMeta.displayName} is ready`
                : 'Start a conversation'}
            </div>
            <div className="chat-empty-subtitle">
              {instance?.config.llmConfig?.model
                ? `${instance.config.llmConfig.model} \u00B7 Type a message`
                : 'Type a message'}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`msg msg--${msg.role}`}>
            <div className={`msg-header${msg.role === 'user' ? ' msg-header--user' : ''}`}>
              <span className="msg-label">
                {msg.role === 'user' ? 'You' : providerMeta?.displayName ?? 'Assistant'}
              </span>
              {msg.isStreaming && (
                <span className="msg-streaming-dots">
                  <span /><span /><span />
                </span>
              )}
              {!msg.isStreaming && msg.timestamp > 0 && (
                <span className="msg-time">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
            <div className={`msg-body msg-body--${msg.role}`}>
              {msg.role === 'user' ? (
                <p className="msg-user-text">{msg.content}</p>
              ) : msg.content ? (
                <MarkdownRenderer content={msg.content} />
              ) : msg.isStreaming ? (
                <span className="streaming-cursor">
                  <span className="streaming-dot" />
                </span>
              ) : null}
            </div>
          </div>
        ))}

        {error && (
          <div className="msg msg--system">
            <span>
              <span className="msg-system-icon" style={{ color: 'var(--error)' }}>{'\u26A0'}</span>
              {error}
            </span>
          </div>
        )}
      </div>

      {/* Scroll navigation buttons */}
      <div className="scroll-nav-buttons">
        {showScrollTopBtn && (
          <button
            className="scroll-nav-btn scroll-to-top-btn"
            onClick={scrollToTop}
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
            onClick={scrollToBottom}
            title="Scroll to bottom (Ctrl+End)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 5L7 10L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {showInput && (
        <div className="chat-input-area">
          <div className="chat-input-row">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                adjustHeight();
              }}
              onKeyDown={handleKeyDown}
              onInput={adjustHeight}
              placeholder={
                isStreaming
                  ? 'Waiting for response...'
                  : `Message ${providerMeta?.displayName ?? 'LLM'}... (Enter to send)`
              }
              disabled={isStreaming}
              rows={1}
              style={{ height: '40px' }}
            />
            {isStreaming ? (
              <button
                className="chat-send-btn chat-send-btn--active"
                onClick={cancelStream}
                title="Cancel (stop generation)"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                className={`chat-send-btn ${input.trim() ? 'chat-send-btn--active' : ''}`}
                onClick={handleSend}
                disabled={!input.trim()}
                title="Send (Enter)"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 8L14 2L8 14L7 9L2 8Z"
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="0.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
