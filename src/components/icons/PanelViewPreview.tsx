import React from 'react';

/**
 * Tiny schematic previews of the two panel kinds — a chat panel (message
 * bubbles + input bar) and a terminal panel (prompt lines + cursor). Used
 * wherever the user picks the view at creation time.
 */
export const PanelViewPreview: React.FC<{
  kind: 'chat' | 'terminal';
  size?: number;
  /** Leave the lower-right area empty so overlaid badges (wizard quick
   *  tile) never sit on drawn elements. */
  clearCorner?: boolean;
}> = ({ kind, size = 44, clearCorner = false }) => {
  const w = size;
  const h = Math.round((size * 3) / 4);

  if (kind === 'chat') {
    return (
      <svg width={w} height={h} viewBox="0 0 44 33" aria-hidden>
        <rect x="0.5" y="0.5" width="43" height="32" rx="3.5"
          fill="rgba(74,158,255,0.06)" stroke="currentColor" strokeOpacity="0.35" />
        {/* toolbar */}
        <rect x="1" y="1" width="42" height="5" rx="2.5" fill="currentColor" fillOpacity="0.18" />
        {/* incoming bubble */}
        <rect x="4" y="9" width="20" height="5" rx="2.5" fill="currentColor" fillOpacity="0.45" />
        {/* outgoing bubble */}
        <rect x="16" y="16" width={clearCorner ? 14 : 24} height="5" rx="2.5" fill="#4a9eff" fillOpacity="0.75" />
        {/* input bar */}
        <rect x="4" y="25" width={clearCorner ? 8 : 36} height="5" rx="2.5"
          fill="none" stroke="currentColor" strokeOpacity="0.5" />
      </svg>
    );
  }

  return (
    <svg width={w} height={h} viewBox="0 0 44 33" aria-hidden>
      <rect x="0.5" y="0.5" width="43" height="32" rx="3.5"
        fill="rgba(0,0,0,0.35)" stroke="currentColor" strokeOpacity="0.35" />
      {/* toolbar */}
      <rect x="1" y="1" width="42" height="5" rx="2.5" fill="currentColor" fillOpacity="0.18" />
      {/* prompt lines */}
      <rect x="4" y="10" width="3" height="2" rx="1" fill="#51cf66" />
      <rect x="9" y="10" width="24" height="2" rx="1" fill="currentColor" fillOpacity="0.5" />
      <rect x="4" y="15" width="3" height="2" rx="1" fill="#51cf66" />
      <rect x="9" y="15" width="16" height="2" rx="1" fill="currentColor" fillOpacity="0.5" />
      <rect x="4" y="20" width="3" height="2" rx="1" fill="#51cf66" />
      <rect x="9" y="20" width={clearCorner ? 4 : 28} height="2" rx="1" fill="currentColor" fillOpacity="0.35" />
      {/* cursor */}
      <rect x="4" y="25" width="3" height="2" rx="1" fill="#51cf66" />
      <rect x="9" y="25" width="4" height="2" rx="0.5" fill="#51cf66" fillOpacity="0.9" />
    </svg>
  );
};
