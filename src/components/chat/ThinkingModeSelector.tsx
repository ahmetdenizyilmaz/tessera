import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type ThinkingMode = 'auto' | 'think' | 'think_hard' | 'think_harder' | 'ultrathink';

interface ThinkingModeSelectorProps {
  instanceId: string;
  value: ThinkingMode;
  onChange: (mode: ThinkingMode) => void;
}

const MODES: { id: ThinkingMode; label: string; tokens: number | null; color: string; desc: string }[] = [
  { id: 'auto', label: 'Auto', tokens: null, color: 'var(--text-muted)', desc: 'Let Claude decide' },
  { id: 'think', label: 'Think', tokens: 10000, color: '#4a9eff', desc: '10K thinking tokens' },
  { id: 'think_hard', label: 'Think Hard', tokens: 25000, color: '#ff922b', desc: '25K thinking tokens' },
  { id: 'think_harder', label: 'Think Harder', tokens: 50000, color: '#ff6b6b', desc: '50K thinking tokens' },
  { id: 'ultrathink', label: 'Ultrathink', tokens: 100000, color: '#cc5de8', desc: '100K thinking tokens' },
];

export const ThinkingModeSelector: React.FC<ThinkingModeSelectorProps> = ({ instanceId, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = MODES.find(m => m.id === value) ?? MODES[0];

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const handleSelect = useCallback((mode: ThinkingMode) => {
    onChange(mode);
    setIsOpen(false);
    const modeConfig = MODES.find(m => m.id === mode);
    invoke('stream_set_thinking', {
      id: instanceId,
      thinkingBudgetTokens: modeConfig?.tokens ?? null,
    }).catch(() => {});
  }, [instanceId, onChange]);

  return (
    <div className="thinking-selector" ref={ref}>
      <button
        className="thinking-selector__btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Thinking mode"
        type="button"
        style={{ color: current.color }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 11V13C6 13.5523 6.44772 14 7 14H9C9.55228 14 10 13.5523 10 13V11" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.5 6.5C6.5 5.5 7 4 8 4S9.5 5.5 9.5 6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 11 }}>{current.label}</span>
      </button>

      {isOpen && (
        <div className="thinking-selector__dropdown">
          {MODES.map(mode => (
            <button
              key={mode.id}
              className={`thinking-selector__option ${mode.id === value ? 'thinking-selector__option--active' : ''}`}
              onClick={() => handleSelect(mode.id)}
              type="button"
            >
              <span className="thinking-selector__dot" style={{ background: mode.color }} />
              <div>
                <div className="thinking-selector__option-label">{mode.label}</div>
                <div className="thinking-selector__option-desc">{mode.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
