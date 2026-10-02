import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useWizardStore } from '../../store/wizardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { AntigravityOptionsForm } from './AntigravityOptionsForm';
import { openAntigravitySession } from '../../lib/antigravitySessions';
import type { AntigravityDiscovery } from '../../types/antigravity';

export function AntigravitySetup({ wizardId }: { wizardId: string }) {
  const s = useWizardStore();
  const defaults = useSettingsStore(st => st.settings.antigravityDefaults);
  const value = s.antigravity ?? defaults;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discovery, setDiscovery] = useState<AntigravityDiscovery | null>(null);
  const signedOut = discovery?.auth.state === 'signed-out';
  const add = async (view: 'chat' | 'terminal' | null) => {
    if (!view || busy) return;
    setBusy(true); setError('');
    try { await openAntigravitySession(value, s.cwd, view, wizardId); }
    catch (e) { setError(String(e)); setBusy(false); }
  };
  return <div className="nsw-step opencode-setup antigravity-setup">
    <div className="nsw-step__label">3 · Antigravity settings</div>
    <AntigravityOptionsForm value={value} onChange={antigravity => s.set({ antigravity })} disabled={busy} view={s.panelView} onDiscovery={setDiscovery} />
    <label className="form-group"><span className="form-label">Project folder</span><div className="form-row">
      <input className="form-input form-input-grow" value={s.cwd} disabled={busy} onChange={e => s.set({ cwd: e.target.value })} placeholder="Choose the project this agent can work in" />
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void open({ directory: true, multiple: false }).then(p => { if (typeof p === 'string') s.set({ cwd: p }); })}>Browse</button>
    </div></label>
    <p className="opencode-hint">These settings belong to this panel and are saved with the workspace. Each panel runs its own agy process and conversation.</p>
    {error && <p className="codex-error" role="alert">{error}</p>}
    <div className="form-row">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { useSettingsStore.getState().updateSettings({ antigravityDefaults: { ...value } }); setError(''); }}>Save as defaults</button>
      {signedOut && s.panelView === 'chat' && !s.fork && <button type="button" className="btn btn-secondary" disabled={busy || !s.cwd.trim()} onClick={() => void add('terminal')}>Open sign-in terminal</button>}
      <button type="button" className="btn btn-primary form-input-grow" disabled={busy || !s.cwd.trim() || !discovery} onClick={() => void add(s.panelView)}>{busy ? 'Starting Antigravity…' : `${s.fork ? 'Fork into' : 'Open'} Antigravity ${s.panelView}`}</button>
    </div>
  </div>;
}
