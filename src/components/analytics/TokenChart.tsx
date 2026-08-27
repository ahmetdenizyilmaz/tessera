import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { SERIES, GRID, AXIS_TICK, TOOLTIP_STYLE, formatAxisTokens, formatShortDate } from './chartTheme';

interface TokenChartProps {
  data: Array<{
    date: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }>;
}

export default function TokenChart({ data }: TokenChartProps) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatShortDate}
        />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatAxisTokens}
          width={44}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'var(--text-secondary)' }}
          cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
          formatter={(value: number, name: string) => [
            value.toLocaleString(),
            name === 'input_tokens' ? 'Input' : 'Output',
          ]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }}
          formatter={(value: string) => (value === 'input_tokens' ? 'Input' : 'Output')}
        />
        {/* 2px round lines; active dot wears a 2px surface ring so it stays
            legible where the two lines cross */}
        <Line
          type="monotone"
          dataKey="input_tokens"
          stroke={SERIES.input}
          strokeWidth={2}
          strokeLinecap="round"
          dot={false}
          activeDot={{ r: 4, fill: SERIES.input, stroke: 'var(--bg-elevated)', strokeWidth: 2 }}
        />
        <Line
          type="monotone"
          dataKey="output_tokens"
          stroke={SERIES.output}
          strokeWidth={2}
          strokeLinecap="round"
          dot={false}
          activeDot={{ r: 4, fill: SERIES.output, stroke: 'var(--bg-elevated)', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
