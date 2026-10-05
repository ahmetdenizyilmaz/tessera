import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { discoverAntigravity } from '../../lib/antigravityDiscovery';
import { ANTIGRAVITY_EFFORTS, effortInModel, ANTIGRAVITY_INSTALL_COMMAND, ANTIGRAVITY_INSTALL_URL, ANTIGRAVITY_PERMISSIONS } from '../../lib/antigravityConfig';
import type { AntigravityDiscovery, AntigravityOptions, AntigravityPermission } from '../../types/antigravity';

const AUTH_LABELS: Record<AntigravityDiscovery['auth']['state'], string> = { 'signed-in': 'Signed in', 'api-key': 'API key', 'signed-out': 'Not signed in', unknown: 'Sign-in not checked' };

/** CLI detection, sign-in status, model and permission choices. Shared by the
 *  wizard, the defaults page and nothing else; no credential passes through it. */
export function AntigravityOptionsForm({ value, onChange, disabled = false, view, onDiscovery }: {
  value: AntigravityOptions; onChange: (value: AntigravityOptions) => void; disabled?: boolean;
  /** Which permission explanation to show; both when omitted (defaults page). */
  view?: 'chat' | 'terminal' | null;
  onDiscovery?: (discovery: AntigravityDiscovery | null) => void;
}) {
  const fieldId = useId();
  const [discovery, setDiscovery] = useState<AntigravityDiscovery | null>(null);
  const [problem, setProblem] = useState('');
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  const patch = (partial: Partial<AntigravityOptions>) => onChange({ ...value, ...partial });
  const check = useCallback(async (fresh: boolean) => {
    const token = ++generation.current;
    setChecking(true);
    try {
      const result = await discoverAntigravity(value.executablePath, fresh);
      if (generation.current !== token) return;
      setDiscovery(result); setProblem(''); onDiscovery?.(result);
    } catch (e) {
      if (generation.current !== token) return;
      setDiscovery(null); setProblem(String(e)); onDiscovery?.(null);
    } finally { if (generation.current === token) setChecking(false); }
  }, [value.executablePath]); // eslint-disable-line react-hooks/exhaustive-deps
  // Typing a custom path must not start the CLI on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void check(false), value.executablePath ? 400 : 0);
    return () => { clearTimeout(timer); generation.current++; };
  }, [check]); // eslint-disable-line react-hooks/exhaustive-deps

  const models = discovery?.models ?? [];
  const permission = ANTIGRAVITY_PERMISSIONS[value.permission];
  return <fieldset className="opencode-options antigravity-options" disabled={disabled}>
    <p className="opencode-hint">Antigravity runs Google's own <code>agy</code> CLI with its own sign-in. Claude Code, Codex and OpenCode are not involved or changed.</p>
    <div className="antigravity-status" role="status" aria-label="Antigravity CLI status">
      {checking && !discovery && !problem && <span>Checking for the Antigravity CLI…</span>}
      {discovery && <>
        <span><strong>CLI found</strong> · agy {discovery.version} · {discovery.path}</span>
        <span className={`antigravity-auth antigravity-auth--${discovery.auth.state}`}><strong>{AUTH_LABELS[discovery.auth.state]}</strong> · {discovery.auth.detail}</span>
        {discovery.auth.state === 'signed-out' && <span>Sign in once with agy's own browser flow: open an Antigravity <strong>Terminal</strong> panel (or run <code>agy</code> in any terminal) and follow its prompt, then check again. Tessera never sees or stores your Google credentials.</span>}
      </>}
      {problem && <>
        <span className="antigravity-auth antigravity-auth--signed-out"><strong>CLI not available</strong> · {problem}</span>
        <span>Install it in PowerShell with <code>{ANTIGRAVITY_INSTALL_COMMAND}</code> (other systems: {ANTIGRAVITY_INSTALL_URL}), run <code>agy</code> once to sign in, then check again. Tessera does not install or update it for you.</span>
      </>}
      <button type="button" className="btn btn-secondary" onClick={() => void check(true)} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
    </div>
    <div className="form-row">
      <label className="form-group"><span className="form-label">Model</span>
        {models.length ? <select className="form-select" aria-label="Antigravity model" value={value.model} onChange={e => patch({ model: e.target.value })}>
          <option value="">agy's saved default model</option>
          {!!value.model && !models.some(m => m.id === value.model) && <option value={value.model}>{value.model}</option>}
          {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select> : <input className="form-input" aria-label="Antigravity model" value={value.model} onChange={e => patch({ model: e.target.value.trim() })} placeholder="Model slug from agy models (empty = agy's default)" />}
      </label>
      <label className="form-group"><span className="form-label">Reasoning effort</span>
        {effortInModel(value.model)
          ? <select className="form-select" aria-label="Reasoning effort" value="" disabled title="This model already names its effort"><option value="">Set by the model ({value.model.split('-').pop()})</option></select>
          : <select className="form-select" aria-label="Reasoning effort" value={value.effort} onChange={e => patch({ effort: e.target.value as AntigravityOptions['effort'] })}>
            {ANTIGRAVITY_EFFORTS.map(effort => <option key={effort} value={effort}>{effort || 'Model default'}</option>)}
          </select>}
      </label>
    </div>
    <small className="opencode-hint">{discovery?.modelsError ? `Models could not be listed (${discovery.modelsError}). Enter a slug from "agy models", or leave empty.` : models.length ? `${models.length} models reported by "agy models" for your account.` : 'Models are listed by the CLI once it is available.'}</small>
    <label className="form-group"><span className="form-label">Permissions</span>
      <select className="form-select" value={value.permission} onChange={e => patch({ permission: e.target.value as AntigravityPermission })}>
        {(Object.keys(ANTIGRAVITY_PERMISSIONS) as AntigravityPermission[]).map(mode => <option key={mode} value={mode}>{ANTIGRAVITY_PERMISSIONS[mode].label} · {ANTIGRAVITY_PERMISSIONS[mode].flag}</option>)}
      </select>
    </label>
    {view !== 'terminal' && <p className="opencode-hint"><strong>Chat:</strong> {permission.chat}</p>}
    {view !== 'chat' && <p className="opencode-hint"><strong>Terminal:</strong> {permission.terminal}</p>}
    <label className="form-checkbox-label"><input type="checkbox" checked={value.sandbox} onChange={e => patch({ sandbox: e.target.checked })} /> Run with agy's terminal sandbox restrictions (<code>--sandbox</code>)</label>
    <details><summary>Antigravity CLI executable</summary>
      <label className="form-group" htmlFor={`${fieldId}-exe`}><span className="form-label">Custom executable (optional)</span></label>
      <div className="form-row">
        <input id={`${fieldId}-exe`} className="form-input form-input-grow" value={value.executablePath} onChange={e => patch({ executablePath: e.target.value })} placeholder="agy.exe · found automatically in %LOCALAPPDATA%\agy\bin and PATH" />
        <button type="button" className="btn btn-secondary" onClick={() => void open({ directory: false, multiple: false, title: 'Choose the Antigravity CLI (agy)' }).then(p => { if (typeof p === 'string') patch({ executablePath: p }); })}>Browse</button>
      </div>
      <p className="opencode-hint">Leave empty to use the official install location. A custom path is used exactly as given and never falls back to another copy.</p>
    </details>
  </fieldset>;
}
