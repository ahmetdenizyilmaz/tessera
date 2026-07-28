import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

  const chartData = data.map(d => ({
    ...d,
    name: d.project_path.split(/[/\\]/).pop() || d.project_path,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 8, left: 80, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={80} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
            formatter={(value: number) => `$${value.toFixed(4)}`}
          />
          <Bar dataKey="cost_usd" fill="var(--accent)" radius={[0, 4, 4, 0]} name="Cost ($)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
