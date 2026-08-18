import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore, canAddPanel, notifyPanelLimit } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';
import { useSettingsStore } from '../store/settingsStore';
import type { InstanceConfig } from '../types/instance';

export type PanelView = 'chat' | 'terminal';

export interface OpenSessionArgs {
  /** Working directory for the panel */
  cwd: string;
  /** Claude session to continue; omit to start a fresh conversation */
  sessionId?: string;
  panelView: PanelView;
  /** Tab label; defaults to the folder name */
  name?: string;
}

/** Last path segment, used as a readable default tab name */
export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Open a panel, optionally continuing an existing Claude session.
 *
 * A running CLI process cannot be adopted (its stdio is bound to the console
 * that launched it), but every session is journaled to
 * ~/.claude/projects/<project>/<id>.jsonl, so resuming by id continues the
 * same conversation with its full context.
 */
export function openSession({ cwd, sessionId, panelView, name }: OpenSessionArgs): string {
  // One conversation, one panel. Resuming a session that is already open
  // would put two Claude processes on the same JSONL: the second loads the
  // file as of its spawn (the conversation appears rewound) and both append
  // to it (the tail interleaves). Focus the existing panel instead.
  if (sessionId) {
    const existing = findOpenPanelBySession(sessionId);
    if (existing) {
      useLayoutStore.getState().setActiveTab(existing);
      useLayoutStore.getState().setFocused(existing);
      return existing;
    }
  }

  // Before addInstance, or a refusal leaks an invisible instance.
  if (!canAddPanel()) {
    notifyPanelLimit();
    return '';
  }

  const settings = useSettingsStore.getState().settings;

  const config: InstanceConfig = {
    cwd,
    model: settings.defaultModel,
    dangerouslySkipPermissions: settings.defaultSkipPermissions,
    permissionMode: settings.defaultPermissionMode,
    allowedTools: [],
    maxBudget: 0,
    systemPrompt: '',
    agentMode: false,
    panelView,
  };

  const id = useInstanceStore.getState().addInstance(config, name ?? folderName(cwd));

  if (sessionId) {
    useInstanceStore.getState().setClaudeSessionId(id, sessionId);
  }

  useLayoutStore.getState().addPanel(id);
  useLayoutStore.getState().setActiveTab(id);
  useLayoutStore.getState().setFocused(id);

  const currentGroupId = useGroupStore.getState().getCurrentGroupId();
  if (currentGroupId) {
    useGroupStore.getState().addToGroup(currentGroupId, id);
  }

  return id;
}

export interface ParsedResume {
  sessionId: string;
  cwd?: string;
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * Parse what Claude Code's /resume puts on the clipboard, e.g.
 *   cd 'C:\path\to\project' ; claude --resume 9fd91c4b-...
 * Also accepts a bare session id, or just `claude --resume <id>`.
 */
export function parseResumeCommand(text: string): ParsedResume | null {
  const input = text.trim();
  if (!input) return null;

  const idMatch = input.match(new RegExp(`(?:--resume|-r)\\s+(${UUID})`))
    ?? input.match(new RegExp(`^(${UUID})$`));
  if (!idMatch) return null;

  // cd 'path'  |  cd "path"  |  cd path
  const cdMatch = input.match(/cd\s+'([^']+)'/)
    ?? input.match(/cd\s+"([^"]+)"/)
    ?? input.match(/cd\s+([^\s;&|]+)/);

  return { sessionId: idMatch[1], cwd: cdMatch?.[1] };
}

/** Every panel that is actually live somewhere — the current tab strip OR
 *  inside any group. instanceStore also holds orphans (no tab, no group); those
 *  don't count as "open". */
function liveePanelIds(): Set<string> {
  const ids = new Set<string>(useLayoutStore.getState().tabOrder);
  for (const g of useGroupStore.getState().groups.values()) {
    for (const c of g.childIds) ids.add(c);
  }
  return ids;
}

/** The panel currently holding this session id, if any — including one that
 *  lives inside a collapsed group. Missing group panels here is how "Open"
 *  could spawn a SECOND process on the same session file. */
export function findOpenPanelBySession(sessionId: string): string | null {
  const live = liveePanelIds();
  for (const inst of useInstanceStore.getState().instances.values()) {
    if (inst.claudeSessionId === sessionId && live.has(inst.id)) return inst.id;
  }
  return null;
}

/** Session ids already open in a panel (tab strip or inside a group) — used to
 *  hide them from "external" lists and badge them "open". */
export function openSessionIds(): Set<string> {
  const live = liveePanelIds();
  const ids = new Set<string>();
  for (const inst of useInstanceStore.getState().instances.values()) {
    if (inst.claudeSessionId && live.has(inst.id)) ids.add(inst.claudeSessionId);
  }
  return ids;
}
