import React from 'react';

/**
 * Auth-mode badges in the framed 44x33 language of PanelViewPreview:
 * short text labels — SUB (subscription), API (key), LOC (local/keyless) —
 * each in its signal color on a subtle tinted frame.
 */
export const AuthBadgePreview: React.FC<{
  variant: 'subscription' | 'apikey' | 'local';
  size?: number;
}> = ({ variant, size = 44 }) => {
  const w = size;
  const h = Math.round((size * 3) / 4);

  const spec = variant === 'subscription'
    ? { text: 'SUB', color: '#4a9eff' }
    : variant === 'apikey'
    ? { text: 'API', color: '#ffd43b' }
    : { text: 'LOC', color: '#51cf66' };

  return (
    <svg width={w} height={h} viewBox="0 0 44 33" aria-hidden>
      <text
        x="22" y="17.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="14"
        fontWeight="700"
        letterSpacing="0.5"
        fill={spec.color}
        fillOpacity="0.95"
      >
        {spec.text}
      </text>
    </svg>
  );
};
