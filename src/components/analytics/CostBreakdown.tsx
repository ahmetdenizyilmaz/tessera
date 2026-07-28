import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';

interface CostBreakdownProps {
  data: Array<{
    model: string;
    cost_usd: number;
  }>;
}

const COLORS = ['#4a9eff', '#51cf66', '#ffd43b', '#ff6b6b', '#c084fc', '#f472b6', '#22d3ee', '#fb923c'];

export default function CostBreakdown({ data }: CostBreakdownProps) {
  const total = data.reduce((sum, d) => sum + d.cost_usd, 0);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <ResponsiveContainer width="50%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="cost_usd"
            nameKey="model"
            cx="50%"
            cy="50%"
            outerRadius={80}
            innerRadius={40}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
            formatter={(value: number) => [`$${value.toFixed(4)}`, 'Cost']}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((item, i) => {
          const pct = total > 0 ? ((item.cost_usd / total) * 100).toFixed(1) : '0';
          return (
            <div key={item.model} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                background: COLORS[i % COLORS.length],
              }} />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.model}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                ${item.cost_usd.toFixed(2)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 36, textAlign: 'right' }}>
                {pct}%
              </span>
            </div>
          );
        })}

        {total > 0 && (
          <div style={{
            marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Total</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>${total.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
