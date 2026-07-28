import React, { useState, useCallback } from 'react';
import type {
  ChatMessage as ChatMessageType,
  AccumulatedMessage,
  AccumulatedUserMessage,
  AccumulatedBlock,
} from '../../types/stream';
import { isUserMessage } from '../../types/stream';
import { MarkdownRenderer } from './MarkdownRenderer';
import { getToolWidget } from '../tools/ToolWidgetRegistry';
import { ProviderIcon } from '../icons/ProviderIcons';

interface ChatMessageProps {
  message: ChatMessageType;
  isLast?: boolean;
  provider?: string;
  /** Hide header for consecutive assistant messages in same turn */
  isContinuation?: boolean;
  /** Hide footer for non-final messages in a consecutive group */
  isGroupEnd?: boolean;
}

// --- User Message ---

const UserMessage: React.FC<{ message: AccumulatedUserMessage }> = ({ message }) => {
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="msg msg--user">
      <div className="msg-header msg-header--user">
        <span className="msg-label">You</span>
        <span className="msg-time">{time}</span>
      </div>
      <div className="msg-body msg-body--user">
        <p className="msg-user-text">{message.text}</p>
      </div>
    </div>
  );
};

// --- Thinking Block ---

const ThinkingBlock: React.FC<{ thinking: string }> = ({ thinking }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="stream-block stream-block--thinking">
      <div
        className="stream-block__thinking-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="stream-block__thinking-icon">{'\u2733'}</span>
        <span>Thinking</span>
        <span className="stream-block__thinking-chevron">
          {expanded ? '\u25B4' : '\u25BE'}
        </span>
      </div>
      {expanded && (
        <div className="stream-block__thinking-content">
          <pre>{thinking}</pre>
        </div>
      )}
    </div>
  );
};

// --- Content Block Renderer ---

const BlockRenderer: React.FC<{
  block: AccumulatedBlock;
  isStreaming: boolean;
  isLastBlock: boolean;
}> = ({ block, isStreaming, isLastBlock }) => {
  if (block.type === 'text') {
    return (
      <div className="stream-block stream-block--text">
        <MarkdownRenderer content={block.text} />
        {isStreaming && isLastBlock && (
          <span className="streaming-cursor">
            <span className="streaming-dot" />
          </span>
        )}
      </div>
    );
  }

  if (block.type === 'tool_use') {
    const Widget = getToolWidget(block.name);
    return (
      <div className="stream-block stream-block--tool">
        <Widget name={block.name} input={block.input} result={block.result} />
      </div>
    );
  }

  if (block.type === 'thinking') {
    return <ThinkingBlock thinking={block.thinking} />;
  }

  return null;
};

// --- Assistant Message ---

const AssistantMessage: React.FC<{
  message: AccumulatedMessage;
  isLast?: boolean;
  provider?: string;
  isContinuation?: boolean;
  isGroupEnd?: boolean;
}> = ({ message, isLast, provider = 'claude', isContinuation, isGroupEnd = true }) => {
  const label = provider === 'claude' ? 'Claude' : provider.charAt(0).toUpperCase() + provider.slice(1);

  // Check if this message only has tool_use blocks (no text)
  const isToolOnly = message.blocks.length > 0 && message.blocks.every(b => b.type === 'tool_use');

  return (
    <div className={`msg msg--assistant${isContinuation ? ' msg--assistant-continuation' : ''}`}>
      {!isContinuation && (
        <div className="msg-header">
          <ProviderIcon provider={provider} size={14} className="msg-provider-icon" />
          <span className="msg-label">{label}</span>
          {message.isStreaming && (
            <span className="msg-streaming-dots">
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
      )}

      <div className="msg-body msg-body--assistant">
        {message.blocks.length === 0 && message.isStreaming && (
          <span className="streaming-cursor">
            <span className="streaming-dot" />
          </span>
        )}

        {message.blocks.map((block, i) => (
          <BlockRenderer
            key={`${block.type}-${i}`}
            block={block}
            isStreaming={message.isStreaming}
            isLastBlock={i === message.blocks.length - 1}
          />
        ))}

        {/* Token usage footer — only on the last message in a consecutive group,
            and skip entirely for tool-only messages within a group */}
        {!message.isStreaming && message.usage && isGroupEnd && !isToolOnly && (
          <div className="msg-footer">
            {message.usage.input_tokens > 0 && (
              <span className="msg-footer-item">
                <em className="msg-footer-icon">{'\u2191'}</em>
                {message.usage.input_tokens.toLocaleString()} in
              </span>
            )}
            {message.usage.output_tokens > 0 && (
              <span className="msg-footer-item">
                <em className="msg-footer-icon">{'\u2193'}</em>
                {message.usage.output_tokens.toLocaleString()} out
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main ChatMessage Component ---

const ChatMessageImpl: React.FC<ChatMessageProps> = ({ message, isLast, provider, isContinuation, isGroupEnd }) => {
  if (isUserMessage(message)) {
    return <UserMessage message={message} />;
  }
  return (
    <AssistantMessage
      message={message}
      isLast={isLast}
      provider={provider}
      isContinuation={isContinuation}
      isGroupEnd={isGroupEnd}
    />
  );
};

export const ChatMessage = React.memo(ChatMessageImpl, (prev, next) => {
  if (prev.message.id !== next.message.id) return false;
  if (prev.provider !== next.provider) return false;
  if (prev.isContinuation !== next.isContinuation) return false;
  if (prev.isGroupEnd !== next.isGroupEnd) return false;
  // Always re-render streaming messages
  if ('isStreaming' in prev.message && prev.message.isStreaming) return false;
  if ('isStreaming' in next.message && next.message.isStreaming) return false;
  return true;
});

export default ChatMessage;
