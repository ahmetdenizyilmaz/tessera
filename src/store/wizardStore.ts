import { create } from 'zustand';
import { useSettingsStore } from './settingsStore';
import type { OpenCodeOptions } from '../types/opencode';

/** Routes the wizard can create. 'claude-sub' and the gw-* entries are real
 *  Claude Code sessions (subscription login / routed gateways); api-* entries
 *  are plain LLM chat panels via llm_create_session. */
export type WizardRoute =
  | 'opencode' | 'codex' | 'claude-sub' | 'gw-openrouter' | 'gw-ollama' | 'gw-custom'
  | 'api-anthropic' | 'api-openai' | 'api-gemini' | 'api-lmstudio' | 'api-ollama';

export interface WizardState {
  opencode: OpenCodeOptions | null;
  panelView: 'chat' | 'terminal' | null;
  /** "Local PC" picked in step 1: connect to another Tessera computer instead. */
  lanMode: boolean;
  /** Fork mode: the created panel inherits this source panel's conversation. */
  fork: { sourceId: string; sourceName: string; messageCount: number; openingMessage: string } | null;
  route: WizardRoute | null;
  /** Claude Code model tier (opus/sonnet/fable/haiku). Always has a default. */
  claudeTier: string;
  /** Gateway or API model id (e.g. "qwen3.8:27b", "gpt-4o"). */
  routeModel: string;
  customBaseUrl: string;
  freeOnly: boolean;
  cwd: string;
  /** Keyring cache: undefined = not checked, '' = checked & absent (red
   *  badge), non-empty = the key VALUE (llm_create_session needs it). */
  keys: Record<string, string | undefined>;
  keyEntryFor: string | null;
  showAdvanced: boolean;
  permissionMode: string;
  skipPermissions: boolean;
  allowedTools: string;
  maxBudget: number;
  systemPrompt: string;
  temperature: number;
  set: (p: Partial<WizardState>) => void;
  reset: () => void;
}

function seededDefaults() {
  const s = useSettingsStore.getState().settings;
  return {
    opencode: null as OpenCodeOptions | null,
    panelView: null as WizardState['panelView'],
    lanMode: false,
    fork: null as WizardState['fork'],
    route: null as WizardState['route'],
    claudeTier: s.lastModel || s.defaultModel,
    routeModel: '',
    customBaseUrl: 'http://localhost:8080',
    freeOnly: true,
    cwd: s.lastCwd || '',
    keys: {} as WizardState['keys'],
    keyEntryFor: null,
    showAdvanced: false,
    permissionMode: s.defaultPermissionMode,
    skipPermissions: s.defaultSkipPermissions,
    allowedTools: '',
    maxBudget: 0,
    systemPrompt: '',
    temperature: 0.7,
  };
}

/** Singleton on purpose: only one wizard panel can exist (addWidgetPanel
 *  dedupes the kind), and the state must survive component unmounts from
 *  group enter/exit and Office-view toggles. */
export const useWizardStore = create<WizardState>((set) => ({
  ...seededDefaults(),
  set: (p) => set(p),
  reset: () => set(seededDefaults()),
}));
