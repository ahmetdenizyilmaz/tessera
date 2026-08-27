import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { useLayoutStore, canAddPanel, notifyPanelLimit, MAX_PANELS } from '../store/layoutStore';
import { useInstanceStore } from '../store/instanceStore';
import { useGroupStore } from '../store/groupStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePluginStore } from '../store/pluginStore';
import { useWizardStore, type WizardRoute } from '../store/wizardStore';
import { LLM_PROVIDERS } from '../types/llmProviders';
import type { InstanceConfig, LlmConfig, LlmProvider, ClaudeRouting } from '../types/instance';
import type { LastSessionPreset } from '../types/session';

/** THE creation entry point: every +/Ctrl+N/menu trigger funnels here. */
export function openNewSessionWizard(): void {
  const id = useLayoutStore.getState().addWidgetPanel('new-session');
  // Empty id = duplicate (refocused the existing wizard, keep its picks) or
  // panel limit (toast already shown) — only a genuinely new panel resets.
  if (id) useWizardStore.getState().reset();
}

export function createGroupPanel(): void {
  if (!canAddPanel()) { notifyPanelLimit(); return; }
  const currentGroupId = useGroupStore.getState().getCurrentGroupId();
  const groupId = useGroupStore.getState().createGroup(currentGroupId);
  useLayoutStore.getState().addPanel(groupId, 'group');
}

export function createPluginPanel(pluginName: string): void {
  if (!canAddPanel()) { notifyPanelLimit(); return; }
  const instanceId = usePluginStore.getState().createInstance(pluginName);
  if (instanceId) {
    useLayoutStore.getState().addPanel(instanceId, 'plugin');
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    if (currentGroupId) {
      useGroupStore.getState().addToGroup(currentGroupId, instanceId);
    }
  }
}

/** Guard tolerating the wizard's own slot, then remove-the-wizard FIRST so
 *  addPanel's internal limit check can't refuse and orphan the new instance. */
export function replaceWizard(wizardId: string, fn: () => void): void {
  const others = useLayoutStore.getState().tabOrder.filter((id) => id !== wizardId);
  if (others.length >= MAX_PANELS) { notifyPanelLimit(); return; }
  useLayoutStore.getState().removePanel(wizardId);
  fn();
}

/** Which keyring provider (if any) a route needs, and its display identity. */
export function routeMeta(route: WizardRoute): {
  branch: 'claude' | 'llm';
  provider: Exclude<LlmProvider, 'claude'> | null;
  keyProvider: string | null;
  gateway?: ClaudeRouting['gateway'];
  label: string;
} {
  switch (route) {
    case 'claude-sub': return { branch: 'claude', provider: null, keyProvider: null, gateway: 'anthropic', label: 'Claude · subscription' };
    case 'gw-openrouter': return { branch: 'claude', provider: 'openrouter', keyProvider: 'openrouter', gateway: 'openrouter', label: 'OpenRouter gateway' };
    case 'gw-ollama': return { branch: 'claude', provider: 'ollama', keyProvider: null, gateway: 'ollama', label: 'Ollama · local' };
    case 'gw-custom': return { branch: 'claude', provider: null, keyProvider: null, gateway: 'custom', label: 'Custom URL' };
    case 'api-anthropic': return { branch: 'llm', provider: 'anthropic', keyProvider: 'anthropic', label: 'Claude API chat' };
    case 'api-openai': return { branch: 'llm', provider: 'openai', keyProvider: 'openai', label: 'OpenAI chat' };
    case 'api-gemini': return { branch: 'llm', provider: 'gemini', keyProvider: 'gemini', label: 'Gemini chat' };
    case 'api-lmstudio': return { branch: 'llm', provider: 'lmstudio', keyProvider: null, label: 'LM Studio chat' };
    case 'api-ollama': return { branch: 'llm', provider: 'ollama', keyProvider: null, label: 'Ollama chat' };
  }
}

export async function checkKey(provider: string): Promise<void> {
  const { keys } = useWizardStore.getState();
  if (keys[provider] !== undefined) return;
  let value = '';
  try {
    value = (await invoke<string | null>('llm_get_api_key', { provider })) ?? '';
  } catch {
    value = '';
  }
  useWizardStore.getState().set({ keys: { ...useWizardStore.getState().keys, [provider]: value } });
}

export async function saveKey(provider: string, key: string): Promise<boolean> {
  try {
    await invoke('llm_set_api_key', { provider, key: key.trim() });
    useWizardStore.getState().set({
      keys: { ...useWizardStore.getState().keys, [provider]: key.trim() },
      keyEntryFor: null,
    });
    return true;
  } catch (err) {
    console.error(`Failed to save ${provider} key:`, err);
    return false;
  }
}

function resolveLlmBaseUrl(provider: Exclude<LlmProvider, 'claude'>): string {
  const settings = useSettingsStore.getState().settings;
  const meta = LLM_PROVIDERS[provider];
  if (provider === 'ollama') return settings.ollamaBaseUrl || meta.defaultBaseUrl;
  if (provider === 'lmstudio') return settings.lmstudioBaseUrl || meta.defaultBaseUrl;
  return meta.defaultBaseUrl;
}

/** The Add flow: turn the wizard panel into the configured session panel. */
export async function createFromWizard(wizardPanelId: string): Promise<void> {
  const s = useWizardStore.getState();
  if (!s.panelView || !s.route) return;
  const meta = routeMeta(s.route);

  const others = useLayoutStore.getState().tabOrder.filter((id) => id !== wizardPanelId);
  if (others.length >= MAX_PANELS) { notifyPanelLimit(); return; }
  useLayoutStore.getState().removePanel(wizardPanelId);

  const settings = useSettingsStore.getState().settings;
  let preset: LastSessionPreset;

  if (meta.branch === 'claude') {
    const cwd = s.cwd || (await homeDir().catch(() => ''));
    const config: InstanceConfig = {
      cwd,
      model: s.claudeTier,
      dangerouslySkipPermissions: s.skipPermissions,
      permissionMode: s.permissionMode,
      allowedTools: s.allowedTools.split(',').map((t) => t.trim()).filter(Boolean),
      maxBudget: s.maxBudget,
      systemPrompt: s.systemPrompt,
      agentMode: settings.defaultAgentMode,
      panelView: s.panelView,
      routing: meta.gateway === 'anthropic'
        ? undefined
        : {
            gateway: meta.gateway!,
            model: s.routeModel.trim() || undefined,
            customBaseUrl: meta.gateway === 'custom' ? s.customBaseUrl.trim() || undefined : undefined,
          },
    };
    const id = useInstanceStore.getState().addInstance(config);
    useLayoutStore.getState().addPanel(id);
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    if (currentGroupId) useGroupStore.getState().addToGroup(currentGroupId, id);

    preset = {
      kind: 'claude',
      panelView: s.panelView,
      gateway: meta.gateway,
      routeModel: s.routeModel.trim() || undefined,
      customBaseUrl: meta.gateway === 'custom' ? s.customBaseUrl.trim() || undefined : undefined,
      model: s.claudeTier,
      cwd,
    };
    useSettingsStore.getState().updateSettings({
      lastSessionPreset: preset,
      lastModel: s.claudeTier,
      lastPanelView: s.panelView,
      lastCwd: cwd,
    });
    return;
  }

  // LLM chat branch — mirrors NewLlmDialog.handleCreate
  const provider = meta.provider!;
  const providerMeta = LLM_PROVIDERS[provider];
  const apiKey = s.keys[meta.keyProvider ?? ''] || null;
  const baseUrl = resolveLlmBaseUrl(provider);
  const model = s.routeModel.trim() || providerMeta.models[0] || '';

  const llmConfig: LlmConfig = {
    provider,
    model,
    systemPrompt: s.systemPrompt,
    // Claude rejects temperature on current models
    temperature: provider === 'anthropic' ? undefined : s.temperature,
    baseUrl,
  };
  const id = useInstanceStore.getState().addInstance(
    {
      cwd: '.',
      model,
      dangerouslySkipPermissions: false,
      permissionMode: 'default',
      allowedTools: [],
      maxBudget: 0,
      systemPrompt: s.systemPrompt,
      agentMode: false,
      llmConfig,
    },
    `${providerMeta.displayName} Chat`,
  );
  try {
    await invoke('llm_create_session', {
      id,
      provider,
      model,
      baseUrl,
      apiKey: providerMeta.requiresApiKey ? apiKey : null,
      systemPrompt: s.systemPrompt,
      temperature: provider === 'anthropic' ? null : s.temperature,
    });
  } catch (err) {
    console.error('Failed to create LLM session:', err);
  }
  useLayoutStore.getState().addPanel(id, 'llm');
  const currentGroupId = useGroupStore.getState().getCurrentGroupId();
  if (currentGroupId) useGroupStore.getState().addToGroup(currentGroupId, id);

  preset = {
    kind: 'llm',
    panelView: s.panelView,
    llmProvider: provider,
    model,
    cwd: '.',
  };
  useSettingsStore.getState().updateSettings({ lastSessionPreset: preset });
}
