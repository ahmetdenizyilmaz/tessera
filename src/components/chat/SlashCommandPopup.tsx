import React, { useEffect, useRef } from 'react';

interface SlashCommand {
  name: string;
  description: string;
  scope: string;
}

interface SlashCommandPopupProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  visible: boolean;
}

export const SlashCommandPopup: React.FC<SlashCommandPopupProps> = ({
  commands,
  selectedIndex,
  onSelect,
  visible,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.children[selectedIndex] as HTMLElement;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!visible) return null;

  if (commands.length === 0) {
    return (
      <div className="slash-command-popup">
        <div className="slash-command-popup__header">Commands</div>
        <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>Loading...</div>
      </div>
    );
  }

  const scopeColors: Record<string, string> = {
    builtin: 'var(--text-muted)',
    user: 'var(--accent)',
    project: 'var(--success)',
  };

  return (
    <div className="slash-command-popup">
      <div className="slash-command-popup__header">Commands</div>
      <div className="slash-command-popup__list" ref={listRef}>
        {commands.map((cmd, i) => (
          <button
            key={cmd.name}
            className={`slash-command-item ${i === selectedIndex ? 'slash-command-item--selected' : ''}`}
            onClick={() => onSelect(cmd)}
            type="button"
          >
            <span className="slash-command-item__name">{cmd.name}</span>
            <span className="slash-command-item__desc">{cmd.description}</span>
            {cmd.scope !== 'builtin' && (
              <span className="slash-command-item__scope" style={{ color: scopeColors[cmd.scope] }}>{cmd.scope}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
