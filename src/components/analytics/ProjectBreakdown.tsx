import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer } from 'recharts';
import { MAGNITUDE, GRID, AXIS_TICK, TOOLTIP_STYLE, formatCost, formatTokens } from './chartTheme';

interface ProjectCost {
  project_path: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  sessions_count: number;
}

interface ProjectBreakdownProps {
  data: ProjectCost[];
}

export const ProjectBreakdown: React.FC<ProjectBreakdownProps> = ({ data }) => {
  if (data.length === 0) {
    return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32, fontSize: 13 }}>No project data</div>;
  }

  const chartData = [...data]
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .map(d => ({
      ...d,
      name: d.project_path.split(/[/\\]/).pop() || d.project_path,
    }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 34)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
          <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={110} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            formatter={(value: number, name: string) =>
              name === 'Cost'
                ? [formatCost(value), 'Cost']
                : [String(value), name]
            }
            labelFormatter={(label: string) => {
              const row = chartData.find((d) => d.name === label);
              return row
                ? `${row.project_path} — ${formatTokens(row.input_tokens + row.output_tokens)} tokens, ${row.sessions_count} sessions`
                : label;
            }}
          />
          {/* single-hue magnitude bars: thin, rounded data-end, square baseline */}
          <Bar dataKey="cost_usd" fill={MAGNITUDE} radius={[0, 4, 4, 0]} barSize={14} name="Cost">
            <LabelList
              dataKey="cost_usd"
              position="right"
              formatter={(v: number) => formatCost(v)}
              style={{ fill: 'var(--text-secondary)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
