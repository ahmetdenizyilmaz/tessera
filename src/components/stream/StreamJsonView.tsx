import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStreamJson } from '../../hooks/useStreamJson';
import StreamMessage from './StreamMessage';

const SCROLL_THRESHOLD = 150;

interface StreamJsonViewProps {
  instanceId: string;
}

const StreamJsonView: React.FC<StreamJsonViewProps> = ({ instanceId }) => {
  const {
    messages,
    isStreaming,
    permissionRequest,
    error,
    spawn,
    send,
    respondPermission,
    cancel,
  } = useStreamJson(instanceId);

  const [inputValue, setInputValue] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
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

  const handleScrollKeyDown = useCallback((e: React.KeyboardEvent) => {
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

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;
    setInputValue('');
    send(text);
  }, [inputValue, isStreaming, send]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="stream-json-view">
      <div className="stream-json-view__messages" ref={containerRef} onScroll={handleScroll} onKeyDown={handleScrollKeyDown} tabIndex={0}>
        {messages.length === 0 && !isStreaming && !error && (
          <div className="stream-json-view__empty">
            <div className="stream-json-view__empty-icon">&#10022;</div>
            <div className="stream-json-view__empty-title">Stream JSON Mode</div>
            <div className="stream-json-view__empty-subtitle">Send a message to begin</div>
          </div>
        )}

        {messages.map((msg) => (
          <StreamMessage key={msg.id} message={msg} />
        ))}

        {error && (
          <div className="stream-json-view__error">
            <span className="stream-json-view__error-icon">&#9888;</span>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Permission request banner */}
      {permissionRequest && (
        <div className="stream-json-view__permission">
          <div className="stream-json-view__permission-title">
            Permission Required: {permissionRequest.tool_name}
          </div>
          {permissionRequest.description && (
            <div className="stream-json-view__permission-desc">
              {permissionRequest.description}
            </div>
          )}
          <pre className="stream-json-view__permission-input">
            {JSON.stringify(permissionRequest.tool_input, null, 2)}
          </pre>
          <div className="stream-json-view__permission-actions">
            <button
              className="stream-json-view__btn stream-json-view__btn--allow"
              onClick={() => respondPermission(true)}
            >
              Allow
            </button>
            <button
              className="stream-json-view__btn stream-json-view__btn--deny"
              onClick={() => respondPermission(false)}
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Scroll navigation buttons */}
      <div className="scroll-nav-buttons">
        {showScrollTopBtn && (
          <button
            className="scroll-nav-btn scroll-to-top-btn"
            onClick={() => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
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
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            title="Scroll to bottom (Ctrl+End)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 5L7 10L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Input area */}
      <div className="stream-json-view__input-area">
        <textarea
          ref={inputRef}
          className="stream-json-view__textarea"
          placeholder={isStreaming ? 'Waiting for response...' : 'Type a message...'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          rows={1}
        />
        <div className="stream-json-view__input-actions">
          {isStreaming ? (
            <button className="stream-json-view__btn stream-json-view__btn--cancel" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button
              className="stream-json-view__btn stream-json-view__btn--send"
              onClick={handleSend}
              disabled={!inputValue.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StreamJsonView;
