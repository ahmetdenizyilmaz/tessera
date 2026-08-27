import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { KeyRound, BadgeCheck, MessageSquare, SquareTerminal, Folder as FolderIcon, Puzzle, ChevronDown, ChevronUp } from 'lucide-react';
import { useWizardStore, type WizardRoute } from '../../store/wizardStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { usePluginStore } from '../../store/pluginStore';
import { LLM_PROVIDERS } from '../../types/llmProviders';
import { PanelViewPreview } from '../icons/PanelViewPreview';
import { ProviderIcon } from '../icons/ProviderIcons';
import {
  routeMeta, checkKey, saveKey, createFromWizard, replaceWizard,
  createGroupPanel, createPluginPanel,
} from '../../lib/newSessionActions';
import type { LastSessionPreset } from '../../types/session';

const CLAUDE_TIERS = ['opus', 'sonnet', 'fable', 'haiku'];

const TERMINAL_ROUTES: WizardRoute[] = ['claude-sub', 'gw-openrouter', 'gw-ollama', 'gw-custom'];
const CHAT_ROUTES: WizardRoute[] = [
  ...TERMINAL_ROUTES,
  'api-anthropic', 'api-openai', 'api-gemini', 'api-lmstudio', 'api-ollama',
];

/** Icon identity for a route tile: claude-sub/custom get the claude glyph,
 *  everything else its provider's logo. */
function routeIconProvider(route: WizardRoute): string {
  const meta = routeMeta(route);
  return meta.provider ?? 'claude';
}

interface NewSessionWizardProps {
  instanceId: string;
}

export default function NewSessionWizard({ instanceId }: NewSessionWizardProps) {
  const s = useWizardStore();
  const settings = useSettingsStore((st) => st.settings);
  const projects = useProjectStore((st) => st.projects);
  const pluginRegistry = usePluginStore((st) => st.registry);

  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const meta = s.route ? routeMeta(s.route) : null;
  const visibleRoutes = s.panelView === 'terminal' ? TERMINAL_ROUTES : CHAT_ROUTES;

  // Keyring presence for every key-requiring provider visible in step 2
  useEffect(() => {
    if (!s.panelView) return;
    const providers = new Set(
      visibleRoutes.map((r) => routeMeta(r).keyProvider).filter((p): p is string => !!p),
    );
    providers.forEach((p) => { checkKey(p); });
  }, [s.panelView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Model discovery per route
  useEffect(() => {
    setModels([]);
    setModelSearch('');
    if (!s.route) return;
    const m = routeMeta(s.route);
    const discover = async (provider: string, baseUrl: string, apiKey: string | null) => {
      setModelsLoading(true);
      try {
        const list = await invoke<string[]>('llm_list_models', { provider, baseUrl, apiKey });
        setModels(list);
      } catch {
        setModels([]);
      } finally {
        setModelsLoading(false);
      }
    };
    if (s.route === 'gw-openrouter') {
      discover('openrouter', LLM_PROVIDERS.openrouter.defaultBaseUrl, null);
    } else if (s.route === 'gw-ollama' || s.route === 'api-ollama') {
      discover('ollama', settings.ollamaBaseUrl || LLM_PROVIDERS.ollama.defaultBaseUrl, null);
    } else if (s.route === 'api-lmstudio') {
      discover('lmstudio', settings.lmstudioBaseUrl || LLM_PROVIDERS.lmstudio.defaultBaseUrl, null);
    } else if (m.branch === 'llm' && m.provider) {
      setModels(LLM_PROVIDERS[m.provider].models);
    }
  }, [s.route]); // eslint-disable-line react-hooks/exhaustive-deps

  // Projects for step 4
  useEffect(() => {
    if (s.route && meta?.branch === 'claude' && projects.length === 0) {
      useProjectStore.getState().fetchProjects();
    }
  }, [s.route]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    useLayoutStore.getState().removePanel(instanceId);
  }, [instanceId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (useWizardStore.getState().keyEntryFor) {
      useWizardStore.getState().set({ keyEntryFor: null });
    } else {
      close();
    }
  }, [close]);

  const pickRoute = (route: WizardRoute) => {
    const m = routeMeta(route);
    if (m.keyProvider && s.keys[m.keyProvider] === '') {
      setKeyDraft('');
      s.set({ keyEntryFor: m.keyProvider });
      return;
    }
    s.set({ route, routeModel: '', keyEntryFor: null });
  };

  const handleSaveKey = async () => {
    const provider = s.keyEntryFor;
    if (!provider || !keyDraft.trim()) return;
    const ok = await saveKey(provider, keyDraft);
    if (ok) {
      setKeyDraft('');
      // Select the route that was blocked on this key
      const blocked = visibleRoutes.find((r) => routeMeta(r).keyProvider === provider);
      if (blocked) s.set({ route: blocked, routeModel: '' });
    }
  };

  const handleImportGguf = async () => {
    try {
      const selected = await open({ multiple: false, filters: [{ name: 'GGUF model', extensions: ['gguf'] }] });
      if (!selected) return;
      const path = selected as string;
      const base = path.split(/[\\/]/).pop() || 'model';
      setImporting(true);
      setImportError('');
      const created = await invoke<string>('ollama_import_gguf', {
        ggufPath: path,
        name: base.replace(/\.gguf$/i, ''),
      });
      const list = await invoke<string[]>('llm_list_models', {
        provider: 'ollama',
        baseUrl: settings.ollamaBaseUrl || LLM_PROVIDERS.ollama.defaultBaseUrl,
        apiKey: null,
      }).catch(() => [] as string[]);
      setModels(list);
      s.set({ routeModel: created });
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) s.set({ cwd: selected as string });
    } catch (err) {
      console.error('Failed to open directory picker:', err);
    }
  };

  const applyPreset = async (preset: LastSessionPreset) => {
    if (preset.kind === 'claude') {
      const route: WizardRoute =
        preset.gateway === 'openrouter' ? 'gw-openrouter'
        : preset.gateway === 'ollama' ? 'gw-ollama'
        : preset.gateway === 'custom' ? 'gw-custom'
        : 'claude-sub';
      s.set({
        panelView: preset.panelView,
        route,
        claudeTier: preset.model,
        routeModel: preset.routeModel ?? '',
        customBaseUrl: preset.customBaseUrl ?? s.customBaseUrl,
        cwd: preset.cwd,
      });
      const m = routeMeta(route);
      if (m.keyProvider) {
        await checkKey(m.keyProvider);
        if (useWizardStore.getState().keys[m.keyProvider] === '') {
          setKeyDraft('');
          s.set({ keyEntryFor: m.keyProvider });
          return;
        }
      }
    } else {
      const route = `api-${preset.llmProvider}` as WizardRoute;
      s.set({ panelView: preset.panelView, route, routeModel: preset.model });
      const m = routeMeta(route);
      if (m.keyProvider) {
        await checkKey(m.keyProvider);
        if (useWizardStore.getState().keys[m.keyProvider] === '') {
          setKeyDraft('');
          s.set({ keyEntryFor: m.keyProvider });
          return;
        }
      }
    }
    createFromWizard(instanceId);
  };

  const visibleModels = (() => {
    let list = models;
    if (s.route === 'gw-openrouter') {
      // openrouter/free is the zero-cost auto-router (picks an available free
      // model for you) — it doesn't carry the :free suffix but IS free.
      const isFree = (m: string) => m.endsWith(':free') || m === 'openrouter/free';
      if (s.freeOnly) {
        const free = list.filter(isFree);
        if (free.length > 0) list = free;
      }
      if (list.includes('openrouter/free')) {
        list = ['openrouter/free', ...list.filter((m) => m !== 'openrouter/free')];
      }
    }
    // Tokenized: "ox alpha" matches "openrouter/ox-alpha" — every word must
    // appear somewhere in the id, order-independent.
    const tokens = modelSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length) {
      list = list.filter((m) => {
        const id = m.toLowerCase();
        return tokens.every((t) => id.includes(t));
      });
    }
    return list;
  })();

  const modelRequirementMet = !s.route ? false
    : s.route === 'claude-sub' ? true
    : s.route === 'gw-custom' ? s.customBaseUrl.trim().length > 0
    : (s.routeModel.trim().length > 0 || (routeMeta(s.route).branch === 'llm' && (LLM_PROVIDERS[routeMeta(s.route).provider!]?.models[0] ?? '') !== ''));

  const canAdd = !!s.panelView && !!s.route && modelRequirementMet;
  const preset = settings.lastSessionPreset;

  return (
    <div className="nsw" tabIndex={-1} onKeyDown={handleKeyDown}>
      {/* Quick tile: last used configuration, one click */}
      {preset && (
        <button className="nsw-quick" onClick={() => applyPreset(preset)} title="Recreate the last session you set up">
          {preset.panelView === 'terminal' ? <SquareTerminal size={14} /> : <MessageSquare size={14} />}
          <ProviderIcon
            provider={preset.kind === 'llm' ? preset.llmProvider! : preset.gateway === 'anthropic' ? 'claude' : preset.gateway === 'custom' ? 'claude' : preset.gateway!}
            size={14}
          />
          {(preset.kind === 'claude' && preset.gateway === 'anthropic')
            ? <span title="Subscription login" style={{ display: 'inline-flex' }}><BadgeCheck size={14} /></span>
            : (preset.kind === 'llm' && ['anthropic', 'openai', 'gemini'].includes(preset.llmProvider!)) || preset.gateway === 'openrouter'
            ? <span title="API key" style={{ display: 'inline-flex' }}><KeyRound size={14} /></span>
            : null}
          <span className="nsw-quick__label">
            Last used · {preset.kind === 'claude' ? (preset.routeModel || preset.model) : preset.model}
            {preset.kind === 'claude' && preset.cwd ? ` · ${preset.cwd.split(/[\\/]/).pop()}` : ''}
          </span>
        </button>
      )}

      {/* Step 1: panel view */}
      <div className="nsw-step">
        <div className="nsw-step__label">1 · Session type</div>
        <div className="panel-view-picker">
          {(['chat', 'terminal'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`panel-view-option${s.panelView === kind ? ' panel-view-option--active' : ''}`}
              onClick={() => s.set({ panelView: kind, route: null, routeModel: '', keyEntryFor: null })}
            >
              <PanelViewPreview kind={kind} size={52} />
              <span className="panel-view-option__label">{kind === 'chat' ? 'Chat' : 'Terminal'}</span>
              <span className="panel-view-option__hint">
                {kind === 'chat' ? 'Rich GUI — widgets, cards, images' : 'Full Claude Code TUI'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: provider / route */}
      {s.panelView && (
        <div className="nsw-step">
          <div className="nsw-step__label">2 · Provider</div>
          <div className="nsw-tiles">
            {visibleRoutes.map((route) => {
              const m = routeMeta(route);
              const noKey = !!m.keyProvider && s.keys[m.keyProvider] === '';
              return (
                <button
                  key={route}
                  type="button"
                  className={
                    'nsw-tile'
                    + (s.route === route ? ' nsw-tile--active' : '')
                    + (noKey ? ' nsw-tile--nokey' : '')
                  }
                  onClick={() => pickRoute(route)}
                  title={noKey ? `${m.label} — API key not set, click to add` : m.label}
                >
                  <ProviderIcon provider={routeIconProvider(route)} size={20} />
                  <span className="nsw-tile__label">{m.label}</span>
                  {noKey && <KeyRound size={12} className="nsw-tile__badge" />}
                  {route === 'claude-sub' && <BadgeCheck size={12} className="nsw-tile__ok" />}
                </button>
              );
            })}
          </div>

          {/* Inline API key entry */}
          {s.keyEntryFor && (
            <div className="form-group" style={{ marginTop: 8 }}>
              <label className="form-label">
                {LLM_PROVIDERS[s.keyEntryFor as keyof typeof LLM_PROVIDERS]?.displayName ?? s.keyEntryFor} API key
              </label>
              <div className="form-row">
                <input
                  className="form-input form-input-grow"
                  type="password"
                  value={keyDraft}
                  autoFocus
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="Paste the API key — stored in the OS keychain"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); }}
                />
                <button className="btn btn-primary" onClick={handleSaveKey} disabled={!keyDraft.trim()}>Save</button>
                <button className="btn btn-secondary" onClick={() => s.set({ keyEntryFor: null })}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: model */}
      {s.route && meta && (
        <div className="nsw-step">
          <div className="nsw-step__label">3 · Model</div>
          {s.route === 'claude-sub' ? (
            <select className="form-select" value={s.claudeTier} onChange={(e) => s.set({ claudeTier: e.target.value })}>
              {CLAUDE_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : s.route === 'gw-custom' ? (
            <div className="form-row" style={{ gap: 8 }}>
              <input
                className="form-input form-input-grow"
                value={s.customBaseUrl}
                onChange={(e) => s.set({ customBaseUrl: e.target.value })}
                placeholder="http://localhost:8080"
              />
              <input
                className="form-input form-input-grow"
                value={s.routeModel}
                onChange={(e) => s.set({ routeModel: e.target.value })}
                placeholder="model id (optional)"
              />
            </div>
          ) : (
            <>
              {models.length > 12 && (
                <div className="form-row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <input
                    className="form-input form-input-grow"
                    value={modelSearch}
                    onChange={(e) => {
                      setModelSearch(e.target.value);
                      // Keep the selection in sync with what's visible
                      s.set({ routeModel: '' });
                    }}
                    placeholder={`Search ${models.length} models…`}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {visibleModels.length} / {models.length}
                  </span>
                </div>
              )}
              <div className="form-row" style={{ gap: 8, alignItems: 'center' }}>
                {visibleModels.length > 0 ? (
                  <select
                    className="form-select form-input-grow"
                    value={s.routeModel || visibleModels[0]}
                    onChange={(e) => s.set({ routeModel: e.target.value })}
                  >
                    {visibleModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input
                    className="form-input form-input-grow"
                    value={s.routeModel}
                    onChange={(e) => s.set({ routeModel: e.target.value })}
                    placeholder={modelsLoading ? 'Loading models…' : 'Model id'}
                  />
                )}
                {s.route === 'gw-openrouter' && (
                  <label className="form-checkbox-label" style={{ whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={s.freeOnly} onChange={() => s.set({ freeOnly: !s.freeOnly })} />
                    Free only
                  </label>
                )}
                {(s.route === 'gw-ollama' || s.route === 'api-ollama') && (
                  <button className="btn btn-secondary" onClick={handleImportGguf} disabled={importing} style={{ whiteSpace: 'nowrap' }}>
                    {importing ? 'Importing…' : 'Import GGUF…'}
                  </button>
                )}
              </div>
              {(s.route === 'gw-ollama' || s.route === 'api-ollama') && !modelsLoading && models.length === 0 && (
                <span className="form-hint">No local models found — is Ollama running?</span>
              )}
              {modelSearch.trim() && visibleModels.length === 0 && models.length > 0 && (
                <span className="form-hint">No models match "{modelSearch.trim()}"{s.freeOnly && s.route === 'gw-openrouter' ? ' — try unchecking Free only' : ''}</span>
              )}
              {importError && <span className="form-hint" style={{ color: 'var(--error)' }}>{importError}</span>}
            </>
          )}
        </div>
      )}

      {/* Step 4: project / directory (Claude Code sessions only) */}
      {s.route && meta?.branch === 'claude' && (
        <div className="nsw-step">
          <div className="nsw-step__label">4 · Project</div>
          <select
            className="form-select"
            value={projects.some((p) => p.path === s.cwd) ? s.cwd : ''}
            onChange={(e) => { if (e.target.value) s.set({ cwd: e.target.value }); }}
          >
            <option value="">Custom directory…</option>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {(p.path.split(/[\\/]/).pop() || p.path) + ' — ' + p.path}
              </option>
            ))}
          </select>
          <div className="form-row" style={{ marginTop: 6 }}>
            <input
              className="form-input form-input-grow"
              value={s.cwd}
              onChange={(e) => s.set({ cwd: e.target.value })}
              placeholder="Working directory"
            />
            <button className="btn btn-secondary" onClick={handleBrowse}>Browse</button>
          </div>
        </div>
      )}

      {/* Footer: Advanced + Add */}
      {s.route && meta && (
        <div className="nsw-step">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => s.set({ showAdvanced: !s.showAdvanced })}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            Advanced {s.showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {s.showAdvanced && meta.branch === 'claude' && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="form-group">
                <label className="form-label">Permission Mode</label>
                <select className="form-select" value={s.permissionMode} onChange={(e) => s.set({ permissionMode: e.target.value })}>
                  {['auto', 'default', 'acceptEdits', 'plan', 'manual', 'dontAsk', 'bypassPermissions'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <label className="form-checkbox-label">
                <input type="checkbox" checked={s.skipPermissions} onChange={() => s.set({ skipPermissions: !s.skipPermissions })} />
                Skip Permissions
              </label>
              <div className="form-group">
                <label className="form-label">Allowed Tools</label>
                <textarea className="form-textarea" rows={2} value={s.allowedTools} onChange={(e) => s.set({ allowedTools: e.target.value })} placeholder="Read, Write, Bash, ..." />
              </div>
              <div className="form-group">
                <label className="form-label">Max Budget</label>
                <input className="form-input" type="number" min={0} value={s.maxBudget} onChange={(e) => s.set({ maxBudget: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label className="form-label">System Prompt</label>
                <textarea className="form-textarea" rows={3} value={s.systemPrompt} onChange={(e) => s.set({ systemPrompt: e.target.value })} placeholder="Optional system prompt..." />
              </div>
            </div>
          )}
          {s.showAdvanced && meta.branch === 'llm' && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="form-group">
                <label className="form-label">System Prompt</label>
                <textarea className="form-textarea" rows={3} value={s.systemPrompt} onChange={(e) => s.set({ systemPrompt: e.target.value })} placeholder="You are a helpful assistant..." />
              </div>
              {s.route !== 'api-anthropic' && (
                <div className="form-group">
                  <label className="form-label">Temperature — {s.temperature.toFixed(1)}</label>
                  <input className="form-range" type="range" min={0} max={2} step={0.1} value={s.temperature} onChange={(e) => s.set({ temperature: parseFloat(e.target.value) })} />
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              disabled={!canAdd}
              onClick={() => createFromWizard(instanceId)}
              title={canAdd ? 'Create the panel' : 'Pick a model first'}
              style={{ width: '100%' }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* More: group + plugin panels */}
      <div className="nsw-more">
        <span className="nsw-more__label">More</span>
        <button className="btn btn-secondary btn-sm" onClick={() => replaceWizard(instanceId, createGroupPanel)}>
          <FolderIcon size={12} style={{ marginRight: 4 }} /> Group
        </button>
        {Array.from(pluginRegistry.keys()).map((name) => (
          <button key={name} className="btn btn-secondary btn-sm" onClick={() => replaceWizard(instanceId, () => createPluginPanel(name))}>
            <Puzzle size={12} style={{ marginRight: 4 }} /> {name}
          </button>
        ))}
      </div>
    </div>
  );
}
