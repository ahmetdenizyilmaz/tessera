import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BarChart3, Download, DollarSign, Hash, Coins } from 'lucide-react';
import TokenChart from './TokenChart';
import CostBreakdown from './CostBreakdown';
import { TimelineChart } from './TimelineChart';
import { ProjectBreakdown } from './ProjectBreakdown';
import { AnalyticsSummaryCards } from './AnalyticsSummaryCards';

interface AnalyticsSummary {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  records_count: number;
  by_date: Array<{ date: string; input_tokens: number; output_tokens: number; cost_usd: number }>;
  by_model: Array<{ model: string; input_tokens: number; output_tokens: number; cost_usd: number }>;
}

interface ProjectCost {
  project_path: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  sessions_count: number;
}

interface TimeCost {
  period: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type DashboardTab = 'overview' | 'by-model' | 'by-project' | 'timeline';

export default function UsageDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [projectData, setProjectData] = useState<ProjectCost[]>([]);
  const [timelineData, setTimelineData] = useState<TimeCost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [timelineMode, setTimelineMode] = useState<'tokens' | 'cost'>('tokens');

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<AnalyticsSummary>('analytics_summary', {
        startDate, endDate,
      });
      setSummary(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const fetchProjectData = async () => {
    try {
      const data = await invoke<ProjectCost[]>('analytics_by_project', { startDate, endDate });
      setProjectData(data);
    } catch {
      setProjectData([]);
    }
  };

  const fetchTimelineData = async () => {
    try {
      const data = await invoke<TimeCost[]>('analytics_timeseries', { startDate, endDate, granularity: 'day' });
      setTimelineData(data);
    } catch {
      // Fallback: use by_date from summary
      if (summary?.by_date) {
        setTimelineData(summary.by_date.map(d => ({ period: d.date, ...d })));
      }
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [startDate, endDate]);

  useEffect(() => {
    if (activeTab === 'by-project') fetchProjectData();
    if (activeTab === 'timeline') fetchTimelineData();
  }, [activeTab, startDate, endDate]);

  const handleExport = () => {
    if (!summary) return;
    const rows = [
      ['Date', 'Input Tokens', 'Output Tokens', 'Cost USD'],
      ...summary.by_date.map((d) => [d.date, d.input_tokens, d.output_tokens, d.cost_usd.toFixed(4)]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usage_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabs: { key: DashboardTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'by-model', label: 'By Model' },
    { key: 'by-project', label: 'By Project' },
    { key: 'timeline', label: 'Timeline' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <BarChart3 size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Analytics</span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExport}
            disabled={!summary}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
          >
            <Download size={12} /> CSV
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          {[
            { label: 'Last 7 Days', days: 7 },
            { label: 'Last 30 Days', days: 30 },
            { label: 'All Time', days: null },
          ].map((preset) => (
            <button
              key={preset.label}
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setStartDate(
                  preset.days
                    ? new Date(Date.now() - preset.days * 86400000).toISOString().slice(0, 10)
                    : '2020-01-01',
                );
                setEndDate(today);
              }}
              style={{ padding: '2px 8px', fontSize: 10 }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="date"
            className="form-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '3px 6px' }}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>to</span>
          <input
            type="date"
            className="form-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '3px 6px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 0, marginTop: 8 }}>
          {tabs.map((tab, i) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '5px 0',
                fontSize: 11,
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                background: activeTab === tab.key ? 'var(--bg-elevated)' : 'transparent',
                border: '1px solid var(--border)',
                borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
                borderRadius: i === 0 ? '4px 0 0 0' : i === tabs.length - 1 ? '0 4px 0 0' : 0,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading && !summary && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</p>
        )}
        {error && (
          <p style={{ textAlign: 'center', color: 'var(--error)', fontSize: 13 }}>{error}</p>
        )}

        {summary && activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Summary cards */}
            <AnalyticsSummaryCards
              totalCost={summary.total_cost_usd}
              totalInputTokens={summary.total_input_tokens}
              totalOutputTokens={summary.total_output_tokens}
              sessionsCount={summary.records_count}
            />

            {/* Token chart */}
            {summary.by_date.length > 0 && (
              <div style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 16,
              }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Token Usage Over Time
                </h3>
                <TokenChart data={summary.by_date} />
              </div>
            )}

            {/* Cost breakdown */}
            {summary.by_model.length > 0 && (
              <div style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 16,
              }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Cost by Model
                </h3>
                <CostBreakdown data={summary.by_model} />
              </div>
            )}
          </div>
        )}

        {summary && activeTab === 'by-model' && (
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 8, overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Model', 'Input Tokens', 'Output Tokens', 'Cost'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === 'Model' ? 'left' : 'right',
                        padding: '8px 12px',
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.by_model.map((m) => (
                  <tr key={m.model} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--text-primary)', fontWeight: 500 }}>{m.model}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatTokens(m.input_tokens)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatTokens(m.output_tokens)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${m.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
                {summary.by_model.length > 0 && (
                  <tr>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>Total</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTokens(summary.total_input_tokens)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTokens(summary.total_output_tokens)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                      ${summary.total_cost_usd.toFixed(4)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {summary.by_model.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No model data available.
              </div>
            )}
          </div>
        )}

        {activeTab === 'by-project' && (
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 16,
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Cost by Project
            </h3>
            <ProjectBreakdown data={projectData} />
          </div>
        )}

        {activeTab === 'timeline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className={`btn btn-sm ${timelineMode === 'tokens' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTimelineMode('tokens')}
              >
                Tokens
              </button>
              <button
                className={`btn btn-sm ${timelineMode === 'cost' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTimelineMode('cost')}
              >
                Cost
              </button>
            </div>
            <div style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 16,
            }}>
              <TimelineChart
                data={timelineData.length > 0 ? timelineData : (summary?.by_date.map(d => ({ period: d.date, ...d })) ?? [])}
                mode={timelineMode}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
