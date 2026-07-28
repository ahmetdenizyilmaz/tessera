import { useSettingsStore } from '../../store/settingsStore';

export function AdvancedSettings() {
  const { settings, updateSettings } = useSettingsStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Default Output Mode</label>
        <select className="form-select" defaultValue="pty">
          <option value="pty">PTY (Terminal)</option>
          <option value="stream-json">Stream JSON (Structured)</option>
        </select>
        <p className="form-hint">PTY gives raw terminal output. Stream JSON gives structured data with tool widgets.</p>
      </div>

      <div className="form-group">
        <label className="form-label">System Monitor Interval: {settings.systemMonitorInterval / 1000}s</label>
        <input
          type="range"
          className="form-range"
          min={1000}
          max={10000}
          step={500}
          value={settings.systemMonitorInterval}
          onChange={(e) => updateSettings({ systemMonitorInterval: parseInt(e.target.value) })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Usage Polling Interval: {settings.usagePollingInterval / 60000} min</label>
        <input
          type="range"
          className="form-range"
          min={60000}
          max={3600000}
          step={60000}
          value={settings.usagePollingInterval}
          onChange={(e) => updateSettings({ usagePollingInterval: parseInt(e.target.value) })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Plan Budget (USD)</label>
        <input
          type="number"
          className="form-input"
          min={0}
          step={0.5}
          value={settings.planBudgetUsd}
          onChange={(e) => updateSettings({ planBudgetUsd: parseFloat(e.target.value) || 0 })}
        />
        <p className="form-hint">Set to 0 for unlimited. Applies to new instances.</p>
      </div>
    </div>
  );
}
