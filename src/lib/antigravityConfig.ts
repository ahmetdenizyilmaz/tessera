import type { AntigravityItem, AntigravityOptions, AntigravityPermission, AntigravitySnapshot, AntigravityUsage } from '../types/antigravity';
import type { ForkMessage } from '../types/instance';

export const DEFAULT_ANTIGRAVITY_OPTIONS: AntigravityOptions = { model: '', effort: '', permission: 'review', sandbox: false, executablePath: '' };

export const ANTIGRAVITY_INSTALL_URL = 'https://www.antigravity.google/docs/cli/install/';
export const ANTIGRAVITY_INSTALL_COMMAND = 'irm https://antigravity.google/cli/install.ps1 | iex';

/** What each mode really does. Chat is agy's headless interface, which cannot prompt. */
export const ANTIGRAVITY_PERMISSIONS: Record<AntigravityPermission, { label: string; flag: string; chat: string; terminal: string }> = {
  review: {
    label: 'Request review (agy default)', flag: 'no flag',
    chat: 'Chat uses agy\'s headless mode, which cannot show approval prompts: a tool that needs approval (shell commands, in agy 1.2.15) is auto-denied and listed in the chat. Allow specific commands with permissions.allow in agy\'s settings.json, or use a terminal panel to approve interactively.',
    terminal: 'The native terminal asks you before actions that need approval.',
  },
  'accept-edits': {
    label: 'Accept edits', flag: '--mode accept-edits',
    chat: 'File edits are accepted without review. Other tools that need approval are still auto-denied in chat and listed.',
    terminal: 'File edits are accepted without review; agy still asks before other actions.',
  },
  plan: {
    label: 'Plan first', flag: '--mode plan',
    chat: 'The agent plans before changing anything. Tools that need approval are still auto-denied in chat and listed.',
    terminal: 'The agent plans before changing anything, and asks before actions that need approval.',
  },
  skip: {
    label: 'Allow everything', flag: '--dangerously-skip-permissions',
    chat: 'Every tool request is approved automatically: commands, file changes and network access run without asking. Use only in a project you trust.',
    terminal: 'Every tool request is approved automatically: commands, file changes and network access run without asking. Use only in a project you trust.',
  },
};

export const ANTIGRAVITY_EFFORTS: AntigravityOptions['effort'][] = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

export function antigravityModelLabel(model: string): string { return model || 'default model'; }

export function antigravityTranscript(items: AntigravityItem[]): ForkMessage[] {
  return items.filter(i => (i.type === 'user' || i.type === 'assistant') && i.text?.trim())
    .map(i => ({ role: i.type as 'user' | 'assistant', content: i.text!.trim(), timestamp: i.at ? new Date(i.at).toISOString() : undefined }));
}

/** agy's tool names in the vocabulary Activity and the office already use. */
export function antigravityOfficeTool(name: string): string {
  if (['run_command', 'send_command_input', 'command_status'].includes(name)) return 'Bash';
  if (name === 'write_to_file') return 'Write';
  if (['replace_file_content', 'multi_replace_file_content', 'sed_file', 'notebook_edit'].includes(name)) return 'Edit';
  if (['view_file', 'read_resource', 'list_resources'].includes(name)) return 'Read';
  if (['grep_search', 'find_by_name', 'list_dir'].includes(name)) return 'Grep';
  if (name === 'search_web') return 'WebSearch';
  if (['invoke_subagent', 'define_subagent', 'manage_subagents', 'browser_subagent'].includes(name)) return 'Agent';
  if (['manage_task', 'schedule'].includes(name)) return 'TodoWrite';
  if (name === 'call_mcp_tool') return 'MCP';
  if (name === 'read_url_content' || name.includes('browser')) return 'WebFetch';
  return name;
}

const short = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
/** "13.2k tokens · 12.5k in · 699 out (330 thinking)". */
export function formatAntigravityUsage(usage: AntigravityUsage): string {
  const parts = [`${short(usage.total)} tokens`, `${short(usage.input)} in`, `${short(usage.output)} out${usage.thinking ? ` (${short(usage.thinking)} thinking)` : ''}`];
  if (usage.cacheRead) parts.push(`${short(usage.cacheRead)} cached`);
  return parts.join(' · ');
}

/** One word for the panel header; never "ready" for a turn that is still open. */
export function antigravityStatus(session: AntigravitySnapshot | undefined, terminalExited: boolean): { label: string; color: string } {
  if (terminalExited) return { label: 'TERMINAL CLOSED', color: '#a0a0a0' };
  if (!session) return { label: 'STARTING', color: '#ffd43b' };
  if (session.busy) return { label: 'WORKING', color: '#51cf66' };
  if (session.error) return { label: session.recovery === 'login' ? 'SIGN IN' : 'ERROR', color: '#ff6b6b' };
  if (!session.configured) return { label: 'STARTING', color: '#ffd43b' };
  return { label: 'READY', color: '#51cf66' };
}
