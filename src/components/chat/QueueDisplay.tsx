import React from 'react';

interface QueuedMessage {
  id: string;
  text: string;
  timestamp: number;
}

interface QueueDisplayProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

export const QueueDisplay: React.FC<QueueDisplayProps> = ({ queue, onRemove, onClear }) => {
  if (queue.length === 0) return null;

  return (
    <div className="queue-display">
      <div className="queue-display__header">
        <span className="queue-display__count">{queue.length} queued</span>
        {queue.length > 1 && (
          <button className="queue-display__clear" onClick={onClear} type="button">Clear all</button>
        )}
      </div>
      <div className="queue-display__list">
        {queue.map((msg) => (
          <div key={msg.id} className="queue-display__item">
            <span className="queue-display__text">{msg.text.length > 60 ? msg.text.slice(0, 60) + '...' : msg.text}</span>
            <button className="queue-display__remove" onClick={() => onRemove(msg.id)} type="button">&times;</button>
          </div>
        ))}
      </div>
    </div>
  );
};
