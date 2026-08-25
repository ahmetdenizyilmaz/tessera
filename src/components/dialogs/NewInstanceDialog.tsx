import React, { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { PanelViewPreview } from '../icons/PanelViewPreview';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore, canAddPanel, notifyPanelLimit } from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import { useSettingsStore } from '../../store/settingsStore';
import { LLM_PROVIDERS } from '../../types/llmProviders';
import type { InstanceConfig } from '../../types/instance';

interface NewInstanceDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewInstanceDialog: React.FC<NewInstanceDialogProps> = ({ isOpen, onClose }) => {
  const { addInstance } = useInstanceStore();
  const { addPanel, setActiveTab } = useLayoutStore();
  const { settings } = useSettingsStore();
  const instanceCount = useInstanceStore((s) => s.instances.size);

  const [name, setName] = useState(() => `Claude ${instanceCount + 1}`);
  // Opens on whatever was created last, falling back to the configured default.
  const [panelView, setPanelView] = useState<'chat' | 'terminal'>(
    settings.lastPanelView || 'chat',
  );
  // Prefill with the last-used folder — panels defaulting to the home
  // directory is what kept mixing them into unrelated home-dir sessions.
  const [cwd, setCwd] = useState(settings.lastCwd || '');
  const [model, setModel] = useState(settings.lastModel || settings.defaultModel);
  const [permissionMode, setPermissionMode] = useState(settings.defaultPermissionMode);
  const [skipPermissions, setSkipPermissions] = useState(settings.defaultSkipPermissions);
  const [allowedTools, setAllowedTools] = useState('');
  const [maxBudget, setMaxBudget] = useState(0);
  const [systemPrompt, setSystemPrompt] = useState('');

  // Claude Code gateway routing. 'anthropic' = the CLI's normal login path,
  // completely untouched; anything else injects routing env into this
  // panel's process only.
  type Gateway = 'anthropic' | 'openrouter' | 'ollama' | 'custom';
  const [gateway, setGatewayRaw] = useState<Gateway>('anthropic');
  const [routeModel, setRouteModel] = useState('');
  const [freeOnly, setFreeOnly] = useState(true);
  const [customUrl, setCustomUrl] = useState('http://localhost:8080');
  const [orModels, setOrModels] = useState<string[]>([]);
  const [olModels, setOlModels] = useState<string[]>([]);
  const [orHasKey, setOrHasKey] = useState<boolean | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const setGateway = (g: Gateway) => {
    setGatewayRaw(g);
    setRouteModel(''); // model ids don't transfer between gateways
  };
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  // Pick a .gguf from disk and register it into Ollama, so it appears in the
  // dropdown like any pulled model. Hashing a multi-GB file takes a while.
  const handleImportGguf = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'GGUF model', extensions: ['gguf'] }],
      });
      if (!selected) return;
      const path = selected as string;
      const base = path.split(/[\\/]/).pop() || 'model';
      const name = base.replace(/\.gguf$/i, '');
      setImporting(true);
      setImportError('');
      const created = await invoke<string>('ollama_import_gguf', { ggufPath: path, name });
      setOlModels([]); // retriggers discovery, which now includes the import
      setRouteModel(created);
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
    }
  };

  // On first switch to OpenRouter: check for a saved key and pull the catalog.
  useEffect(() => {
    if (gateway !== 'openrouter' || orHasKey !== null) return;
    invoke<string | null>('llm_get_api_key', { provider: 'openrouter' })
      .then((k) => setOrHasKey(!!k))
      .catch(() => setOrHasKey(false));
    setRouteLoading(true);
    invoke<string[]>('llm_list_models', {
      provider: 'openrouter',
      baseUrl: LLM_PROVIDERS.openrouter.defaultBaseUrl,
      apiKey: null,
    })
      .then((models) => setOrModels(models))
      .catch(() => setOrModels([]))
      .finally(() => setRouteLoading(false));
  }, [gateway, orHasKey]);

  // On first switch to Ollama: list the locally pulled models.
  useEffect(() => {
    if (gateway !== 'ollama' || olModels.length > 0) return;
    setRouteLoading(true);
    invoke<string[]>('llm_list_models', {
      provider: 'ollama',
      baseUrl: settings.ollamaBaseUrl || LLM_PROVIDERS.ollama.defaultBaseUrl,
      apiKey: null,
    })
      .then((models) => setOlModels(models))
      .catch(() => setOlModels([]))
      .finally(() => setRouteLoading(false));
  }, [gateway, olModels.length, settings.ollamaBaseUrl]);

  const routeVisibleModels = (() => {
    if (gateway === 'ollama') return olModels;
    const source = orModels.length > 0 ? orModels : LLM_PROVIDERS.openrouter.models;
    const filtered = freeOnly ? source.filter((m) => m.endsWith(':free')) : source;
    return filtered.length > 0 ? filtered : source;
  })();
  const effectiveRouteModel = routeModel || routeVisibleModels[0] || '';

  // BUG-1: Close dialog on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) setCwd(selected as string);
    } catch (err) {
      console.error('Failed to open directory picker:', err);
    }
  };

  const handleCreate = async () => {
    if (!canAddPanel()) { notifyPanelLimit(); return; }
    const config: InstanceConfig = {
      cwd: cwd || (await homeDir().catch(() => '')),
      model,
      dangerouslySkipPermissions: skipPermissions,
      permissionMode,
      allowedTools: allowedTools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      maxBudget,
      systemPrompt,
      agentMode: false,
      panelView,
      routing:
        gateway === 'anthropic'
          ? undefined
          : {
              gateway,
              model: (gateway === 'custom' ? routeModel : effectiveRouteModel) || undefined,
              customBaseUrl: gateway === 'custom' ? customUrl.trim() || undefined : undefined,
            },
    };

    // Remember these choices for the next time the dialog opens.
    useSettingsStore.getState().updateSettings({
      lastModel: model,
      lastPanelView: panelView,
      lastCwd: cwd,
    });

    const id = addInstance(config, name || undefined);
    addPanel(id);
    setActiveTab(id);
    // Register in current group if inside one
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    if (currentGroupId) {
      useGroupStore.getState().addToGroup(currentGroupId, id);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="dialog-header">
          <h3 className="dialog-title">New Claude Instance</h3>
          <button className="dialog-close-btn" onClick={onClose}>{'\u00D7'}</button>
        </div>

        <div className="dialog-body" style={{ overflowY: 'auto', flex: 1 }}>
          <div className="form-group">
            <label className="form-label">Session Type</label>
            <div className="panel-view-picker">
              {/* Last-created type sits on the left, so the common case is the
                  first thing under the cursor. */}
              {(settings.lastPanelView === 'terminal'
                ? (['terminal', 'chat'] as const)
                : (['chat', 'terminal'] as const)
              ).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`panel-view-option${panelView === kind ? ' panel-view-option--active' : ''}`}
                  onClick={() => setPanelView(kind)}
                >
                  <PanelViewPreview kind={kind} />
                  <span className="panel-view-option__label">
                    {kind === 'chat' ? 'Chat' : 'Terminal'}
                  </span>
                  <span className="panel-view-option__hint">
                    {kind === 'chat'
                      ? 'Rich GUI — widgets, question cards, images'
                      : 'Full Claude Code TUI in a real terminal'}
                  </span>
                </button>
              ))}
            </div>
            <div className="form-hint">
              Fixed for this session — chat and terminal are separate conversations.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Instance name"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Working Directory</label>
            <div className="form-row">
              <input
                className="form-input form-input-grow"
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="Path to working directory"
              />
              <button className="btn btn-secondary" onClick={handleBrowse}>
                Browse
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Model</label>
            <select className="form-select" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="opus">Opus (default)</option>
              <option value="sonnet">Sonnet</option>
              <option value="fable">Fable</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Route Through</label>
            <select
              className="form-select"
              value={gateway}
              onChange={(e) => setGateway(e.target.value as typeof gateway)}
            >
              <option value="anthropic">Anthropic (normal Claude Code)</option>
              <option value="openrouter">OpenRouter gateway</option>
              <option value="ollama">Ollama (local models)</option>
              <option value="custom">Custom Anthropic-compatible URL</option>
            </select>
            {(gateway === 'openrouter' || gateway === 'ollama') && (
              <>
                <div className="form-row" style={{ marginTop: 8, alignItems: 'center', gap: 8 }}>
                  <select
                    className="form-select form-input-grow"
                    value={effectiveRouteModel}
                    onChange={(e) => setRouteModel(e.target.value)}
                  >
                    {routeVisibleModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {gateway === 'openrouter' && (
                    <label className="form-checkbox-label" style={{ whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={freeOnly}
                        onChange={() => setFreeOnly(!freeOnly)}
                      />
                      Free only
                    </label>
                  )}
                  {gateway === 'ollama' && (
                    <button
                      className="btn btn-secondary"
                      onClick={handleImportGguf}
                      disabled={importing}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {importing ? 'Importing…' : 'Import GGUF…'}
                    </button>
                  )}
                </div>
                {gateway === 'ollama' && importing && (
                  <span className="form-hint">
                    Registering the file with Ollama — large models take a few minutes.
                  </span>
                )}
                {gateway === 'ollama' && importError && (
                  <span className="form-hint" style={{ color: 'var(--error)' }}>{importError}</span>
                )}
                <span className="form-hint">
                  {routeLoading
                    ? 'Loading model list…'
                    : gateway === 'ollama'
                      ? olModels.length === 0
                        ? 'No local models found — is Ollama running? (ollama serve)'
                        : `This panel's Claude Code runs fully local via Ollama; the model above serves every tier. Other panels are unaffected.`
                      : `This panel's Claude Code talks to OpenRouter; the model above serves every tier. Other panels are unaffected.`}
                  {gateway === 'openrouter' && orHasKey === false && (
                    <strong> No OpenRouter API key saved — add one in Settings → LLM Providers first.</strong>
                  )}
                </span>
              </>
            )}
            {gateway === 'custom' && (
              <>
                <div className="form-row" style={{ marginTop: 8, gap: 8 }}>
                  <input
                    className="form-input form-input-grow"
                    type="text"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="http://localhost:8080"
                  />
                  <input
                    className="form-input form-input-grow"
                    type="text"
                    value={routeModel}
                    onChange={(e) => setRouteModel(e.target.value)}
                    placeholder="model id (optional)"
                  />
                </div>
                <span className="form-hint">
                  Any server speaking the Anthropic Messages API — llama.cpp server,
                  LiteLLM proxy, etc. Leave model empty to use the server's default.
                </span>
              </>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Permission Mode</label>
            <select className="form-select" value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)}>
              <option value="auto">auto</option>
              <option value="default">default</option>
              <option value="acceptEdits">acceptEdits</option>
              <option value="plan">plan</option>
              <option value="manual">manual</option>
              <option value="dontAsk">dontAsk</option>
              <option value="bypassPermissions">bypassPermissions</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-checkbox-label">
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={() => setSkipPermissions(!skipPermissions)}
              />
              Skip Permissions
            </label>
          </div>

          <div className="form-group">
            <label className="form-label">Allowed Tools</label>
            <textarea
              className="form-textarea"
              value={allowedTools}
              onChange={(e) => setAllowedTools(e.target.value)}
              placeholder="Read, Write, Bash, ..."
              rows={2}
            />
            <span className="form-hint">
              Comma-separated. Leave empty unless you want to narrow what this
              instance may do — the permission mode above already governs it.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Max Budget</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={maxBudget}
              onChange={(e) => setMaxBudget(parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">System Prompt</label>
            <textarea
              className="form-textarea"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Optional system prompt..."
              rows={3}
            />
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleCreate}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
