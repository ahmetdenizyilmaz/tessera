import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        {mode === 'tokens' ? (
          <>
            <Area type="monotone" dataKey="input_tokens" stackId="1" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.3} name="Input" />
            <Area type="monotone" dataKey="output_tokens" stackId="1" stroke="var(--success)" fill="var(--success)" fillOpacity={0.3} name="Output" />
          </>
        ) : (
          <Area type="monotone" dataKey="cost_usd" stroke="var(--warning)" fill="var(--warning)" fillOpacity={0.3} name="Cost ($)" />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
};
