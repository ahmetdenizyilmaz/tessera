import React from 'react';

/**
 * Schematic previews for HOW a session authenticates, drawn in the same
 * framed 44x33 language as PanelViewPreview so they sit next to each other
 * in the wizard: a subscription seal, a masked API-key field, or a local
 * chip for on-device/keyless routes.
 */
export const AuthBadgePreview: React.FC<{
  variant: 'subscription' | 'apikey' | 'local';
  size?: number;
}> = ({ variant, size = 44 }) => {
  const w = size;
  const h = Math.round((size * 3) / 4);

  if (variant === 'subscription') {
    return (
      <svg width={w} height={h} viewBox="0 0 44 33" aria-hidden>
        <rect x="0.5" y="0.5" width="43" height="32" rx="3.5"
          fill="rgba(74,158,255,0.06)" stroke="currentColor" strokeOpacity="0.35" />
        {/* seal */}
        <circle cx="13" cy="16" r="7.5" fill="#4a9eff" fillOpacity="0.2"
          stroke="#4a9eff" strokeOpacity="0.9" />
        <path d="M9.5 16 l2.5 2.6 l4.5 -5" fill="none" stroke="#4a9eff"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* account rows */}
        <rect x="25" y="11" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity="0.45" />
        <rect x="25" y="18" width="10" height="3" rx="1.5" fill="currentColor" fillOpacity="0.3" />
      </svg>
    );
  }

  if (variant === 'apikey') {
    return (
      <svg width={w} height={h} viewBox="0 0 44 33" aria-hidden>
        <rect x="0.5" y="0.5" width="43" height="32" rx="3.5"
          fill="rgba(255,212,59,0.05)" stroke="currentColor" strokeOpacity="0.35" />
        {/* key: bow + shaft + teeth */}
        <circle cx="11" cy="13" r="4.5" fill="none" stroke="#ffd43b"
          strokeOpacity="0.9" strokeWidth="2" />
        <path d="M15 16.5 L24 25 M20.5 21.5 l3 -3 M24 25 l3 -3" fill="none"
          stroke="#ffd43b" strokeOpacity="0.9" strokeWidth="2" strokeLinecap="round" />
        {/* masked key field */}
        <rect x="26" y="9" width="14" height="6" rx="3"
          fill="none" stroke="currentColor" strokeOpacity="0.5" />
        <circle cx="30" cy="12" r="1.1" fill="currentColor" fillOpacity="0.6" />
        <circle cx="33.5" cy="12" r="1.1" fill="currentColor" fillOpacity="0.6" />
        <circle cx="37" cy="12" r="1.1" fill="currentColor" fillOpacity="0.6" />
      </svg>
    );
  }

  return (
    <svg width={w} height={h} viewBox="0 0 44 33" aria-hidden>
      <rect x="0.5" y="0.5" width="43" height="32" rx="3.5"
        fill="rgba(81,207,102,0.05)" stroke="currentColor" strokeOpacity="0.35" />
      {/* chip: die + pins */}
      <rect x="15" y="10" width="14" height="13" rx="2"
        fill="#51cf66" fillOpacity="0.15" stroke="#51cf66" strokeOpacity="0.9" strokeWidth="1.5" />
      <rect x="19" y="14" width="6" height="5" rx="1" fill="#51cf66" fillOpacity="0.8" />
      {[12, 17, 22].map((y) => (
        <React.Fragment key={y}>
          <rect x="10" y={y} width="4" height="1.8" rx="0.9" fill="currentColor" fillOpacity="0.5" />
          <rect x="30" y={y} width="4" height="1.8" rx="0.9" fill="currentColor" fillOpacity="0.5" />
        </React.Fragment>
      ))}
    </svg>
  );
};
