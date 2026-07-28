import React, { useState } from 'react';
import { INSTANCE_COLORS } from '../../types/instance';

interface ColorPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  currentColor: string;
  onColorChange: (color: string) => void;
  anchorEl?: HTMLElement | null;
}

export const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = ({
  isOpen,
  onClose,
  currentColor,
  onColorChange,
  anchorEl,
}) => {
  const [customHex, setCustomHex] = useState('');

  if (!isOpen) return null;

  const style: React.CSSProperties = {
    // Always fixed: the anchor rect is in viewport coordinates, and absolute
    // positioning inside a mosaic tile would misplace and clip the popover
    position: 'fixed',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-md)',
    padding: 12,
    zIndex: 1100,
    boxShadow: '0 8px 24px var(--shadow)',
    minWidth: 180,
  };

  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    style.top = Math.min(rect.bottom + 4, window.innerHeight - 220);
    style.left = Math.min(rect.left, window.innerWidth - 200);
  } else {
    style.top = '50%';
    style.left = '50%';
    style.transform = 'translate(-50%, -50%)';
  }

  const handleSelect = (color: string) => {
    onColorChange(color);
    onClose();
  };

  const handleCustomSubmit = () => {
    const hex = customHex.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      handleSelect(hex);
    }
  };

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
        onClick={onClose}
      />
      <div className="color-picker-popover" style={style}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 500 }}>
          Pick a color
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {INSTANCE_COLORS.map((color) => (
            <div
              key={color}
              onClick={() => handleSelect(color)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: color,
                cursor: 'pointer',
                border: color === currentColor ? '2px solid #fff' : '2px solid transparent',
                boxShadow: color === currentColor ? '0 0 0 2px var(--accent)' : 'none',
                transition: 'transform 150ms ease',
              }}
              onMouseEnter={(e) => { (e.target as HTMLDivElement).style.transform = 'scale(1.15)'; }}
              onMouseLeave={(e) => { (e.target as HTMLDivElement).style.transform = 'scale(1)'; }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
            placeholder="#ff00ff"
            style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
          />
          <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={handleCustomSubmit}>
            Set
          </button>
        </div>
      </div>
    </>
  );
};
