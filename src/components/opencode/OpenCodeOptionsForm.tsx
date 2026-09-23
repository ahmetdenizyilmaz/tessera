import { useEffect, useId, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { isCompatibleProvider, OPENCODE_PROVIDERS, openCodeKeySlot } from '../../lib/opencodeConfig';
import type { OpenCodeOptions, OpenCodeProvider } from '../../types/opencode';
import { useWizardStore } from '../../store/wizardStore';

/** The same form powers defaults and per-panel setup. No API key enters config. */
export function OpenCodeOptionsForm({ value, onChange, disabled = false }: {
  value: OpenCodeOptions; onChange: (value: OpenCodeOptions) => void; disabled?: boolean;
}) {
  const fieldId = useId();
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cli, setCli] = useState('');
  const generation = useRef(0);
  const compatible = isCompatibleProvider(value.provider);
  let slot = '';
  try { slot = openCodeKeySlot(value); } catch { /* Invalid URL is reported by discovery / creation. */ }
  useEffect(() => {
    const token = ++generation.current;
    setKey(''); setHasKey(false); setModels([]); setMessage(''); setLoading(false);
    if (slot) invoke<string | null>('llm_get_api_key', { provider: slot }).then(k => {
      if (generation.current === token) setHasKey(!!k?.trim());
    }).catch(() => {});
    return () => { generation.current++; };
  }, [slot]);
  const patch = (partial: Partial<OpenCodeOptions>) => onChange({ ...value, ...partial });
  const saveKey = async () => {
    if (!slot || !key.trim()) return;
    const token = generation.current;
    try {
      await invoke('llm_set_api_key', { provider: slot, key: key.trim() });
      useWizardStore.getState().set({ keys: { ...useWizardStore.getState().keys, [slot]: key.trim() } });
      if (generation.current === token) { setKey(''); setHasKey(true); setMessage('API key saved in the OS keychain.'); }
    } catch (e) { if (generation.current === token) setMessage(String(e)); }
  };
  const discover = async () => {
    const token = generation.current;
    setLoading(true); setMessage('');
    try {
      const result = await invoke<string[]>('opencode_models', { config: { ...value, cwd: '', dataId: crypto.randomUUID() } });
      if (generation.current !== token) return;
      setModels(result);
      setMessage(result.length ? `Connected · ${result.length} models. Choose a coding model with tool support.` : 'Connected, but no models are loaded. Load a model in your local server first.');
    } catch (e) { if (generation.current === token) setMessage(String(e)); }
    finally { if (generation.current === token) setLoading(false); }
  };
  const checkCli = async () => {
    setChecking(true);
    try { const result = await invoke<{ path: string; version: string }>('opencode_discover', { executablePath: value.executablePath }); setCli(`OpenCode ${result.version} · ${result.path}`); }
    catch (e) { setCli(String(e)); }
    finally { setChecking(false); }
  };
  return <fieldset className="opencode-options" disabled={disabled}>
    <p className="opencode-hint">OpenCode runs the coding tools. The provider supplies the model. Claude Code and its login stay unchanged.</p>
    <label className="form-group"><span className="form-label">Model provider</span>
      <select className="form-select" value={value.provider} onChange={e => patch({ provider: e.target.value as OpenCodeProvider, model: '', baseUrl: '' })}>
        {Object.entries(OPENCODE_PROVIDERS).map(([p, label]) => <option key={p} value={p}>{label}</option>)}
      </select>
    </label>
    {compatible && <label className="form-group"><span className="form-label">OpenAI-compatible base URL</span>
      <input className="form-input" value={value.baseUrl} onChange={e => patch({ baseUrl: e.target.value })} placeholder={value.provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : value.provider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'https://your-server.example/v1'} />
      <small className="opencode-hint">Root URLs get /v1 automatically. Custom API paths are preserved. Local models run on the PC hosting this panel.</small>
    </label>}
    <div className="form-group">
      <label className="form-label" htmlFor={`${fieldId}-key`}>API key {compatible ? '(optional)' : '(required)'} · {hasKey ? 'saved' : 'not saved'}</label>
      <div className="form-row"><input id={`${fieldId}-key`} className="form-input form-input-grow" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={hasKey ? 'Enter a replacement key' : 'Stored only in the OS keychain'} />
        <button type="button" className="btn btn-secondary" disabled={!key.trim() || !slot} onClick={() => void saveKey()}>Save key</button>
      </div>
      <small className="opencode-hint">{compatible ? 'Keys for compatible servers are scoped to this exact endpoint.' : 'Reuses the key in LLM Providers. API billing is separate from Claude/ChatGPT subscriptions.'}</small>
    </div>
    <label className="form-group"><span className="form-label">Model ID</span>
      <div className="form-row"><input className="form-input form-input-grow" list={`${fieldId}-models`} value={value.model} onChange={e => patch({ model: e.target.value })} placeholder={value.provider === 'openrouter' ? 'vendor/model · use Discover models to find IDs' : 'Exact model ID from your provider'} />
        <button type="button" className="btn btn-secondary" onClick={() => void discover()} disabled={loading || !!key.trim()}>{loading ? 'Checking…' : 'Discover models'}</button>
      </div>
      <datalist id={`${fieldId}-models`}>{models.map(m => <option key={m} value={m} />)}</datalist>
      <small className="opencode-hint">Discovery makes no model calls. You can also type a model ID. Save any new key before checking.</small>
    </label>
    {message && <p role="status" className="opencode-hint">{message}</p>}
    {compatible && <>
      <p className="opencode-hint">Use a model with tool calling. Match these limits to your local server; a larger value here does not increase the model's actual context. No models are downloaded automatically.</p>
      <div className="form-row">
        <label className="form-group"><span className="form-label">Context tokens</span><input className="form-input" type="number" min={4096} value={value.contextLimit} onChange={e => patch({ contextLimit: Number(e.target.value) })} /></label>
        <label className="form-group"><span className="form-label">Max output tokens</span><input className="form-input" type="number" min={256} value={value.outputLimit} onChange={e => patch({ outputLimit: Number(e.target.value) })} /></label>
      </div>
    </>}
    <div className="form-row">
      <label className="form-group"><span className="form-label">Agent mode</span><select className="form-select" value={value.agent} onChange={e => patch({ agent: e.target.value as OpenCodeOptions['agent'] })}><option value="build">Build · coding agent</option><option value="plan">Plan · analyze before building</option></select></label>
      <label className="form-group"><span className="form-label">Tool permissions</span><select className="form-select" value={value.permission} onChange={e => patch({ permission: e.target.value as OpenCodeOptions['permission'] })}><option value="ask">Ask before actions (recommended)</option><option value="allow">Allow all tools</option></select></label>
    </div>
    <p className="opencode-hint">{value.permission === 'allow' ? 'Allow all lets the agent execute commands, edit files, and access the network without approval.' : 'Reading/searching the project is allowed; other tools ask for approval.'} These are agent permissions, not an OS sandbox.</p>
    <details><summary>OpenCode CLI & advanced</summary>
      <label className="form-group"><span className="form-label">OpenCode executable (optional if on PATH)</span><div className="form-row">
        <input className="form-input form-input-grow" value={value.executablePath} onChange={e => { patch({ executablePath: e.target.value }); setCli(''); }} placeholder="opencode.exe / opencode" />
        <button type="button" className="btn btn-secondary" onClick={() => void open({ directory: false, multiple: false, title: 'Choose OpenCode executable' }).then(p => { if (typeof p === 'string') patch({ executablePath: p }); })}>Browse</button>
      </div></label>
      <button type="button" className="btn btn-secondary" onClick={() => void checkCli()} disabled={checking}>{checking ? 'Checking…' : 'Check OpenCode CLI'}</button>
      {cli && <p role="status" className="opencode-hint">{cli}</p>}
      <p className="opencode-hint">Install separately with <code>npm install -g opencode-ai</code>, then Check. Tested with OpenCode 1.18.32. Tessera does not alter Claude Code or global OpenCode settings.</p>
      <label className="form-group"><span className="form-label">Additional instructions</span><textarea className="form-textarea" rows={3} value={value.instructions} onChange={e => patch({ instructions: e.target.value })} /></label>
      <label className="form-checkbox-label"><input type="checkbox" checked={value.projectConfig} onChange={e => patch({ projectConfig: e.target.checked })} /> Load trusted project OpenCode configuration and plugins</label>
      <p className="opencode-hint">Off by default. Enabling project configuration can load code, MCP servers, and extra instructions from the project. Only enable for projects you trust.</p>
    </details>
  </fieldset>;
}
