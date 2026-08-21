import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function StorageSettings() {
  const [dbStats, setDbStats] = useState<{ size: string; tables: Record<string, number> } | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Get basic stats from analytics
      const summary = await invoke<any>('analytics_summary', {});
      setDbStats({
        size: 'N/A',
        tables: {
          'Usage Records': summary.records_count || 0,
        },
      });
    } catch {
      // DB might not have data yet
      setDbStats({ size: 'N/A', tables: {} });
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await invoke<string>('analytics_export_csv', {});
      // Create and download blob
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tessera-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Database Storage</label>
        <p className="form-hint">SQLite database at ~/.tessera/tessera.db</p>
      </div>

      {dbStats && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}>
          {Object.entries(dbStats.tables).map(([name, count]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{name}</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{count} records</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export Usage CSV'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={loadStats}>Refresh Stats</button>
      </div>
    </div>
  );
}
