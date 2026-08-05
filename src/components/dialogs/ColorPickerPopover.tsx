import React, { useState } from 'react';
import { createPortal } from 'react-dom';
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

  // Positioning only — appearance lives in .color-picker-popover so the
  // portaled node still looks like the rest of the app.
  const WIDTH = 208;
  const HEIGHT = 150;
  const style: React.CSSProperties = { position: 'fixed', zIndex: 1100, width: WIDTH };

  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    // Sit beside the context menu rather than on top of it; flip to the left
    // when there isn't room on the right.
    const right = rect.right + 8;
    style.left = right + WIDTH <= window.innerWidth - 8
      ? right
      : Math.max(8, rect.left - WIDTH - 8);
    style.top = Math.max(8, Math.min(rect.top, window.innerHeight - HEIGHT - 8));
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

  // Rendered into document.body: inside a mosaic tile the popover is subject
  // to that tile's stacking context and overflow:hidden, which can leave it
  // clipped or painted underneath the panel.
  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
      />
      <div
        className="color-picker-popover"
        style={style}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="color-picker-popover__title">Pick a color</div>
        <div className="color-picker-popover__swatches">
          {/* Real buttons, not divs: MosaicLayout's pointer-down handler only
              lets clicks through for button/input/select/textarea, and would
              otherwise treat a swatch click as a panel focus/drag. */}
          {INSTANCE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              onClick={() => handleSelect(color)}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                borderRadius: '50%',
                background: color,
                cursor: 'pointer',
                border: color === currentColor ? '2px solid #fff' : '2px solid transparent',
                boxShadow: color === currentColor ? '0 0 0 2px var(--accent)' : 'none',
                transition: 'transform 150ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            />
          ))}
        </div>
        <div className="color-picker-popover__hex">
          <input
            className="color-picker-popover__input"
            type="text"
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
            placeholder="#ff00ff"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') handleCustomSubmit();
            }}
          />
          <button
            type="button"
            className="color-picker-popover__set"
            onClick={handleCustomSubmit}
          >
            Set
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
};
