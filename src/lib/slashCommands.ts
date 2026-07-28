export interface SlashCommandDef {
  name: string;
  description: string;
  scope: 'builtin' | 'user' | 'project';
  source_path?: string;
}

export const BUILTIN_SLASH_COMMANDS: SlashCommandDef[] = [
  { name: '/help', description: 'Show help and available commands', scope: 'builtin' },
  { name: '/clear', description: 'Clear conversation history', scope: 'builtin' },
  { name: '/compact', description: 'Compact conversation to save context', scope: 'builtin' },
  { name: '/config', description: 'Show or update configuration', scope: 'builtin' },
  { name: '/cost', description: 'Show token usage and cost', scope: 'builtin' },
  { name: '/model', description: 'Switch model', scope: 'builtin' },
  { name: '/status', description: 'Show session status', scope: 'builtin' },
  { name: '/review', description: 'Review code changes', scope: 'builtin' },
  { name: '/init', description: 'Initialize CLAUDE.md for a project', scope: 'builtin' },
  { name: '/memory', description: 'Edit CLAUDE.md memory files', scope: 'builtin' },
];

export function filterCommands(commands: SlashCommandDef[], query: string): SlashCommandDef[] {
  if (!query) return commands;
  const q = query.toLowerCase();
  return commands.filter(c => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
}
