import React, { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore, canAddPanel, notifyPanelLimit } from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import { useSettingsStore } from '../../store/settingsStore';
import { LLM_PROVIDERS, type ProviderMeta } from '../../types/llmProviders';
import type { LlmProvider, LlmConfig } from '../../types/instance';
import claudeIcon from '../../assets/claude-icon.ico';
import openaiIcon from '../../assets/openai-icon.png';
import geminiIcon from '../../assets/gemini-icon.png';
import ollamaIcon from '../../assets/ollama-icon.svg';
import lmstudioIcon from '../../assets/lmstudio-icon.png';
import openrouterIcon from '../../assets/openrouter-icon.svg';

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: claudeIcon,
  openai: openaiIcon,
  openrouter: openrouterIcon,
  gemini: geminiIcon,
  ollama: ollamaIcon,
  lmstudio: lmstudioIcon,
};

interface NewLlmDialogProps {
  isOpen: boolean;
  initialProvider?: Exclude<LlmProvider, 'claude'>;
  onClose: () => void;
}

type SelectableProvider = Exclude<LlmProvider, 'claude'>;

const providerList = Object.values(LLM_PROVIDERS) as ProviderMeta[];

export const NewLlmDialog: React.FC<NewLlmDialogProps> = ({ isOpen, initialProvider, onClose }) => {
  const [provider, setProvider] = useState<SelectableProvider>(initialProvider ?? 'openai');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [apiKey, setApiKey] = useState('');
  const [saveKey, setSaveKey] = useState(true);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [error, setError] = useState('');

  // Sync initialProvider when dialog opens
  useEffect(() => {
    if (isOpen && initialProvider) {
      setProvider(initialProvider);
    }
  }, [isOpen, initialProvider]);

  const meta = LLM_PROVIDERS[provider];

  // Per-provider base URL: local providers have a settings override; cloud
  // providers (openai/openrouter/…) use their canonical endpoint.
  const resolveBaseUrl = useCallback(() => {
    const settings = useSettingsStore.getState().settings;
    if (provider === 'ollama') return settings.ollamaBaseUrl || meta.defaultBaseUrl;
    if (provider === 'lmstudio') return settings.lmstudioBaseUrl || meta.defaultBaseUrl;
    return meta.defaultBaseUrl;
  }, [provider, meta]);

  // Load saved API key when provider changes
  useEffect(() => {
    if (!isOpen) return;
    setApiKey('');
    setDiscoveredModels([]);
    setConnectionStatus('idle');
    setError('');

    if (meta.requiresApiKey) {
      invoke<string | null>('llm_get_api_key', { provider }).then((key) => {
        if (key) setApiKey(key);
      }).catch(() => {});
    }

    // Set default model
    if (meta.models.length > 0) {
      setModel(meta.models[0]);
    } else {
      setModel('');
    }
  }, [provider, isOpen, meta]);

  // Discover models for local providers
  const discoverModels = useCallback(async () => {
    if (!meta.supportsModelDiscovery) return;
    setDiscovering(true);
    setError('');
    try {
      const baseUrl = resolveBaseUrl();
      const models = await invoke<string[]>('llm_list_models', {
        provider,
        baseUrl,
        apiKey: apiKey || null,
      });
      setDiscoveredModels(models);
      if (models.length > 0 && (!model || !models.includes(model))) {
        setModel(models[0]);
      }
      setConnectionStatus('ok');
    } catch (err) {
      setError(`Failed to list models: ${err}`);
      setConnectionStatus('fail');
    }
    setDiscovering(false);
  }, [provider, meta, model, apiKey, resolveBaseUrl]);

  // Auto-discover on mount for local providers
  useEffect(() => {
    if (isOpen && meta.supportsModelDiscovery) {
      discoverModels();
    }
  }, [isOpen, provider]);

  const testConnection = useCallback(async () => {
    setConnectionStatus('checking');
    setError('');
    try {
      const baseUrl = resolveBaseUrl();
      // llm_check_connection resolves Ok(false) on a failed connection —
      // the returned bool is the verdict, not the promise settling.
      const ok = await invoke<boolean>('llm_check_connection', { provider, baseUrl });
      setConnectionStatus(ok ? 'ok' : 'fail');
      if (!ok) setError('Connection failed');
    } catch (err) {
      setConnectionStatus('fail');
      setError(`Connection failed: ${err}`);
    }
  }, [provider, resolveBaseUrl]);

  const handleCreate = useCallback(async () => {
    if (!canAddPanel()) { notifyPanelLimit(); return; }
    if (!model) {
      setError('Please select a model');
      return;
    }

    if (meta.requiresApiKey && !apiKey) {
      setError('API key is required');
      return;
    }

    // Save API key if requested
    if (meta.requiresApiKey && apiKey && saveKey) {
      try {
        await invoke('llm_set_api_key', { provider, key: apiKey });
      } catch (err) {
        console.error('Failed to save API key:', err);
      }
    }

    const baseUrl = resolveBaseUrl();

    const llmConfig: LlmConfig = {
      provider,
      model,
      systemPrompt,
      // Not stored for Claude either — session recreation after a restart
      // rebuilds from this config and must not resend a rejected param.
      temperature: provider === 'anthropic' ? undefined : temperature,
      baseUrl,
    };

    // Create instance
    const id = useInstanceStore.getState().addInstance(
      {
        cwd: '.',
        model,
        dangerouslySkipPermissions: false,
        permissionMode: 'default',
        allowedTools: [],
        maxBudget: 0,
        systemPrompt,
        agentMode: false,
        llmConfig,
      },
      `${meta.displayName} Chat`,
    );

    // Create LLM session on backend
    try {
      await invoke('llm_create_session', {
        id,
        provider,
        model,
        baseUrl,
        apiKey: meta.requiresApiKey ? apiKey : null,
        systemPrompt,
        // Claude rejects temperature on current models; don't store one so
        // the panel doesn't pretend the slider did something.
        temperature: provider === 'anthropic' ? null : temperature,
      });
    } catch (err) {
      console.error('Failed to create LLM session:', err);
    }

    // Add panel to layout
    useLayoutStore.getState().addPanel(id, 'llm');
    // Register in current group if inside one
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    if (currentGroupId) {
      useGroupStore.getState().addToGroup(currentGroupId, id);
    }

    onClose();
  }, [provider, model, systemPrompt, temperature, apiKey, saveKey, meta, onClose]);

  if (!isOpen) return null;

  const allModels = meta.supportsModelDiscovery
    ? discoveredModels
    : meta.models;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxHeight: '80vh' }}
      >
        <div className="dialog-header">
          <h3 className="dialog-title">New LLM Chat</h3>
          <button className="dialog-close-btn" onClick={onClose}>{'\u00D7'}</button>
        </div>

        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Provider selector */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
              Provider
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {providerList.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id as SelectableProvider)}
                  style={{
                    padding: '10px 12px',
                    border: `1px solid ${provider === p.id ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 6,
                    background: provider === p.id ? 'rgba(74, 158, 255, 0.1)' : 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <img src={PROVIDER_ICONS[p.id]} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />
                  <div>
                    <div style={{ fontWeight: 500 }}>{p.displayName}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {p.requiresApiKey ? 'Cloud API' : 'Local'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* API Key (for cloud providers) */}
          {meta.requiresApiKey && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`${meta.displayName} API key`}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              />
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={saveKey}
                  onChange={(e) => setSaveKey(e.target.checked)}
                />
                Save to keychain
              </label>
            </div>
          )}

          {/* Connection test for local providers */}
          {meta.supportsModelDiscovery && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-secondary"
                onClick={testConnection}
                disabled={connectionStatus === 'checking'}
                style={{ fontSize: 12 }}
              >
                {connectionStatus === 'checking' ? 'Testing...' : 'Test Connection'}
              </button>
              {connectionStatus === 'ok' && (
                <span style={{ color: '#51cf66', fontSize: 12 }}>{'\u2713'} Connected</span>
              )}
              {connectionStatus === 'fail' && (
                <span style={{ color: '#ff6b6b', fontSize: 12 }}>{'\u2717'} Failed</span>
              )}
            </div>
          )}

          {/* Model selector */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
              Model
            </label>
            {allModels.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                }}
              >
                {allModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Enter model name"
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                  }}
                />
                {meta.supportsModelDiscovery && (
                  <button
                    className="btn btn-secondary"
                    onClick={discoverModels}
                    disabled={discovering}
                    style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                  >
                    {discovering ? 'Loading...' : 'Refresh'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* System prompt */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
              System Prompt (optional)
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant..."
              rows={3}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: 13,
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Temperature — hidden for Claude: current Claude models reject
              the parameter, so showing a slider would be a lie */}
          {provider !== 'anthropic' && (
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>Temperature</span>
              <span>{temperature.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          )}

          {error && (
            <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate}>
            Create Chat
          </button>
        </div>
      </div>
    </div>
  );
};
