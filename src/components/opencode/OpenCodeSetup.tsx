import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useWizardStore } from '../../store/wizardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { OpenCodeOptionsForm } from './OpenCodeOptionsForm';
import { openOpenCodeSession } from '../../lib/opencodeSessions';
import { isCompatibleProvider, openCodeEndpoint } from '../../lib/opencodeConfig';
export function OpenCodeSetup({ wizardId }: { wizardId: string }) {
  const s = useWizardStore();
  const defaults = useSettingsStore(st => st.settings.openCodeDefaults);
  const value = s.opencode ?? defaults;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async () => {
    if (!s.panelView || busy) return;
    setBusy(true); setError('');
    try { await openOpenCodeSession(value, s.cwd, s.panelView, wizardId); }
    catch (e) { setError(String(e)); setBusy(false); }
  };
  const saveDefaults = () => {
    try {
      if (isCompatibleProvider(value.provider)) openCodeEndpoint(value.provider, value.baseUrl);
      useSettingsStore.getState().updateSettings({ openCodeDefaults: { ...value } });
      setError('');
    } catch (e) { setError(String(e)); }
  };
  return <div className="nsw-step opencode-setup">
    <div className="nsw-step__label">3 · OpenCode settings</div>
    <OpenCodeOptionsForm value={value} onChange={opencode => s.set({ opencode })} disabled={busy} />
    <label className="form-group"><span className="form-label">Project folder</span><div className="form-row">
      <input className="form-input form-input-grow" value={s.cwd} disabled={busy} onChange={e => s.set({ cwd: e.target.value })} placeholder="Choose the project this agent can work in" />
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void open({ directory: true, multiple: false }).then(p => { if (typeof p === 'string') s.set({ cwd: p }); })}>Browse</button>
    </div></label>
    <p className="opencode-hint">These settings belong to this panel and are saved with the workspace. Global defaults only affect new panels.</p>
    {error && <p className="codex-error" role="alert">{error}</p>}
    <div className="form-row">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={saveDefaults}>Save as defaults</button>
      <button type="button" className="btn btn-primary form-input-grow" disabled={busy || !value.model.trim() || !s.cwd.trim()} onClick={() => void add()}>{busy ? 'Starting OpenCode…' : `${s.fork ? 'Fork into' : 'Open'} OpenCode ${s.panelView}`}</button>
    </div>
  </div>;
}
