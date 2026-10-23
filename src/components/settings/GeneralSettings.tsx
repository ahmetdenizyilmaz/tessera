import { useSettingsStore } from '../../store/settingsStore';
import { CodexPermissionSelect } from '../codex/CodexPermissionSelect';

export function GeneralSettings() {
  const { settings, updateSettings } = useSettingsStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label" htmlFor="panel-hibernation-timeout">Hibernate unused agent panels</label>
        <select id="panel-hibernation-timeout" className="form-select" value={settings.panelHibernationMinutes}
          onChange={event => updateSettings({ panelHibernationMinutes: Number(event.target.value) })}>
          <option value={0}>Never automatically</option>
          <option value={15}>After 15 minutes</option>
          <option value={30}>After 30 minutes</option>
          <option value={60}>After 1 hour</option>
          <option value={120}>After 2 hours</option>
          <option value={240}>After 4 hours</option>
        </select>
        <span className="form-hint">Frees idle agent processes and their MCP servers, keeping a dimmed preview. Wake resumes the conversation. Time with Tessera closed or your computer asleep does not count. Focused panels, active tasks, pending answers and drafts stay awake. Terminals without reliable activity reporting can be hibernated manually from Panel controls. Auto-save preserves sleeping panels across restarts.</span>
      </div>
      <div className="form-group">
        <label className="form-label">Default Model</label>
        <select
          className="form-select"
          value={settings.defaultModel}
          onChange={(e) => updateSettings({ defaultModel: e.target.value })}
        >
          <option value="opus">Claude Opus</option>
          <option value="sonnet">Claude Sonnet</option>
          <option value="fable">Claude Fable</option>
          <option value="haiku">Claude Haiku</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Fork opening message</label>
        <textarea
          className="form-textarea"
          rows={2}
          value={settings.forkOpeningMessage}
          onChange={(e) => updateSettings({ forkOpeningMessage: e.target.value })}
          placeholder="Leave empty to send nothing"
        />
        <span className="form-hint">Optional. Leave empty to carry over the conversation and wait for your next message. If provided, it is sent automatically when the fork opens. You can edit it per fork.</span>
      </div>

      <div className="form-group">
        <label className="form-label">Panel shortcuts</label>
        <span className="form-hint">Focus a panel and press Alt+0–9 to assign a number. Ctrl+that number focuses it, including inside groups. Hold Ctrl to see blue Ctrl + number labels. Hold Alt to see red assignment labels; Ctrl + ? appears only on the focused panel if it has no shortcut. Unfocused, unassigned panels show no label. Release the keys to hide them. Assigning an occupied number moves it to the selected panel. Shortcuts are included in workspace files and restored on restart when Auto-save workspace is enabled.</span>
      </div>

      <div className="form-group">
        <label className="form-label">Default Claude Permission Mode</label>
        <select
          className="form-select"
          value={settings.defaultPermissionMode}
          onChange={(e) => updateSettings({ defaultPermissionMode: e.target.value })}
        >
          {/* Matches the CLI's own choices (acceptEdits, auto,
              bypassPermissions, manual, dontAsk, plan). "Default" is the app's
              own sentinel meaning "don't pass --permission-mode at all". */}
          <option value="auto">Auto</option>
          <option value="default">Default (CLI's own)</option>
          <option value="acceptEdits">Accept Edits</option>
          <option value="plan">Plan</option>
          <option value="manual">Manual</option>
          <option value="dontAsk">Don't Ask</option>
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
          Skip Claude permissions by default
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

      <div>
        <CodexPermissionSelect
          label="Default Codex permissions"
          value={settings.defaultCodexPermissionMode}
          onChange={(mode) => updateSettings({ defaultCodexPermissionMode: mode })}
        />
        <p className="form-hint">
          Used for new Codex panels. Change an existing panel from its Panel controls menu.
        </p>
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
