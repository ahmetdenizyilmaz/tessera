import React, { useState } from 'react';
import type {
  AccumulatedMessage,
  AccumulatedBlock,
  ChatMessage,
} from '../../types/stream';
import { isUserMessage } from '../../types/stream';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { getToolWidget } from '../tools/ToolWidgetRegistry';

interface StreamMessageProps {
  message: ChatMessage;
}

const StreamMessage: React.FC<StreamMessageProps> = ({ message }) => {
  // Handle user messages from chatStore
  if (isUserMessage(message)) {
    return (
      <div className="stream-message stream-message--user">
        <div className="stream-message__role">You</div>
        <div className="stream-message__blocks">
          <div className="stream-block stream-block--text">
            <p>{message.text}</p>
          </div>
        </div>
      </div>
    );
  }

  // Handle assistant messages (AccumulatedMessage)
  const assistantMsg = message as AccumulatedMessage;
  return (
    <div className={`stream-message stream-message--${assistantMsg.role}`}>
      <div className="stream-message__role">
        {assistantMsg.role === 'assistant' ? 'Claude' : 'User'}
      </div>
      <div className="stream-message__blocks">
        {assistantMsg.blocks.map((block, i) => (
          <StreamBlock key={i} block={block} isStreaming={assistantMsg.isStreaming} />
        ))}
      </div>
      {assistantMsg.isStreaming && assistantMsg.blocks.length === 0 && (
        <div className="stream-message__typing">
          <span className="stream-message__dot" />
          <span className="stream-message__dot" />
          <span className="stream-message__dot" />
        </div>
      )}
    </div>
  );
};

interface StreamBlockProps {
  block: AccumulatedBlock;
  isStreaming: boolean;
}

const StreamBlock: React.FC<StreamBlockProps> = ({ block, isStreaming }) => {
  if (block.type === 'text') {
    return (
      <div className="stream-block stream-block--text">
        <MarkdownRenderer content={block.text} />
        {isStreaming && <span className="stream-block__cursor" />}
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

const ThinkingBlock: React.FC<{ thinking: string }> = ({ thinking }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="stream-block stream-block--thinking">
      <div className="stream-block__thinking-header" onClick={() => setExpanded(!expanded)}>
        <span className="stream-block__thinking-icon">&#9733;</span>
        <span>Thinking</span>
        <span className="stream-block__thinking-chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="stream-block__thinking-content">
          <pre>{thinking}</pre>
        </div>
      )}
    </div>
  );
};

export default StreamMessage;
