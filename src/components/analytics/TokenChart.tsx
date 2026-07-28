import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          stroke="var(--border)"
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
        />
        <YAxis
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          stroke="var(--border)"
          tickFormatter={(v: number) => {
            if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
            if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
            return String(v);
          }}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--text-primary)',
          }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          formatter={(value: number, name: string) => [
            value.toLocaleString(),
            name === 'input_tokens' ? 'Input' : 'Output',
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }}
          formatter={(value: string) => (value === 'input_tokens' ? 'Input Tokens' : 'Output Tokens')}
        />
        <Line
          type="monotone"
          dataKey="input_tokens"
          stroke="#4a9eff"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#4a9eff' }}
        />
        <Line
          type="monotone"
          dataKey="output_tokens"
          stroke="#fb923c"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#fb923c' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
