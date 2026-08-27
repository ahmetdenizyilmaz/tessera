import { MAGNITUDE, formatCost } from './chartTheme';

interface CostBreakdownProps {
  data: Array<{
    model: string;
    cost_usd: number;
  }>;
}

/** Ranked horizontal bars — magnitude in one hue, identity carried by the row
 *  label. (Replaced a donut with a cycled 8-color palette: slices are hard to
 *  compare and cycled hues break identity; a ranked list is the honest form
 *  for "which model costs the most".) */
export default function CostBreakdown({ data }: CostBreakdownProps) {
  const total = data.reduce((sum, d) => sum + d.cost_usd, 0);
  const sorted = [...data].sort((a, b) => b.cost_usd - a.cost_usd);
  const max = sorted[0]?.cost_usd ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((item) => {
        const pct = total > 0 ? ((item.cost_usd / total) * 100).toFixed(1) : '0';
        const barPct = max > 0 ? Math.max(1.5, (item.cost_usd / max) * 100) : 0;
        return (
          <div key={item.model} title={`${item.model} — ${formatCost(item.cost_usd)} (${pct}%)`}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
              <span style={{
                flex: 1, fontSize: 12, color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.model}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {formatCost(item.cost_usd)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {pct}%
              </span>
            </div>
            {/* track = one lighter step of the same hue family; data-end rounded, baseline square */}
            <div style={{ height: 8, background: 'rgba(61, 135, 224, 0.12)', borderRadius: '0 4px 4px 0' }}>
              <div style={{
                height: '100%',
                width: `${barPct}%`,
                background: MAGNITUDE,
                borderRadius: '0 4px 4px 0',
              }} />
            </div>
          </div>
        );
      })}

      {total > 0 && (
        <div style={{
          marginTop: 2, paddingTop: 8, borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Total</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>${total.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
