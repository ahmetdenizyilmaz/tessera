import { useSettingsStore } from '../../store/settingsStore';

export function GeneralSettings() {
  const { settings, updateSettings } = useSettingsStore();
  const theme = (settings as any).theme ?? 'dark';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Theme</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'dark', label: 'Dark', color: '#1a1a2e' },
            { id: 'gray', label: 'Gray', color: '#333333' },
            { id: 'light', label: 'Light', color: '#e8e4f0' },
            { id: 'white', label: 'White', color: '#fafafa' },
            { id: 'nord', label: 'Nord', color: '#2e3440' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => updateSettings({ theme: t.id } as any)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '8px 12px',
                border: theme === t.id ? '2px solid var(--accent)' : '2px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg-elevated)',
                cursor: 'pointer',
                minWidth: 70,
                transition: 'border-color 0.15s',
              }}
            >
              <div style={{
                width: 36,
                height: 24,
                borderRadius: 4,
                background: t.color,
                border: '1px solid var(--border)',
              }} />
              <span style={{
                fontSize: 11,
                color: theme === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: theme === t.id ? 600 : 400,
              }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Default Model</label>
        <select
          className="form-select"
          value={settings.defaultModel}
          onChange={(e) => updateSettings({ defaultModel: e.target.value })}
        >
          <option value="sonnet">Claude Sonnet</option>
          <option value="opus">Claude Opus</option>
          <option value="fable">Claude Fable</option>
          <option value="haiku">Claude Haiku</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Default Permission Mode</label>
        <select
          className="form-select"
          value={settings.defaultPermissionMode}
          onChange={(e) => updateSettings({ defaultPermissionMode: e.target.value })}
        >
          <option value="default">Default</option>
          <option value="plan">Plan</option>
          <option value="bypassPermissions">Bypass Permissions</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-checkbox-label">
          <input
            type="checkbox"
            checked={settings.defaultSkipPermissions}
            onChange={(e) => updateSettings({ defaultSkipPermissions: e.target.checked })}
          />
          Skip permissions by default
        </label>
      </div>

      <div className="form-group">
        <label className="form-checkbox-label">
          <input
            type="checkbox"
            checked={settings.defaultAgentMode}
            onChange={(e) => updateSettings({ defaultAgentMode: e.target.checked })}
          />
          Agent mode by default
        </label>
      </div>

      <div className="form-group">
        <label className="form-label">Font Size: {settings.fontSize}px</label>
        <input
          type="range"
          className="form-range"
          min={10}
          max={24}
          value={settings.fontSize}
          onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Font Family</label>
        <input
          className="form-input"
          value={settings.fontFamily}
          onChange={(e) => updateSettings({ fontFamily: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-checkbox-label">
          <input
            type="checkbox"
            checked={settings.autoSave}
            onChange={(e) => updateSettings({ autoSave: e.target.checked })}
          />
          Auto-save workspaces
        </label>
      </div>
    </div>
  );
}
