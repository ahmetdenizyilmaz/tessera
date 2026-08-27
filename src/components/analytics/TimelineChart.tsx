import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { SERIES, MAGNITUDE, GRID, AXIS_TICK, TOOLTIP_STYLE, formatAxisTokens, formatShortDate } from './chartTheme';

interface TimelineChartProps {
  data: Array<{ period: string; input_tokens: number; output_tokens: number; cost_usd: number }>;
  mode: 'tokens' | 'cost';
}

export const TimelineChart: React.FC<TimelineChartProps> = ({ data, mode }) => {
  if (data.length === 0) {
    return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32, fontSize: 13 }}>No data for this time range</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="period"
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={formatShortDate}
        />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={mode === 'tokens' ? formatAxisTokens : (v: number) => `$${v}`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: 'var(--text-secondary)' }}
          cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
          formatter={(value: number, name: string) => [
            mode === 'cost' ? `$${value.toFixed(4)}` : value.toLocaleString(),
            name,
          ]}
        />
        {mode === 'tokens' ? (
          <>
            {/* two stacked series: legend is mandatory; fills are a ~10% wash
                so the 2px strokes stay the data marks */}
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }}
            />
            <Area type="monotone" dataKey="input_tokens" stackId="1" stroke={SERIES.input} strokeWidth={2} fill={SERIES.input} fillOpacity={0.12} name="Input" />
            <Area type="monotone" dataKey="output_tokens" stackId="1" stroke={SERIES.output} strokeWidth={2} fill={SERIES.output} fillOpacity={0.12} name="Output" />
          </>
        ) : (
          // single series: the mode toggle names it, no legend box
          <Area type="monotone" dataKey="cost_usd" stroke={MAGNITUDE} strokeWidth={2} fill={MAGNITUDE} fillOpacity={0.12} name="Cost" />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
};
