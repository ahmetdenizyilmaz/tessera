import type { WorkerActivity } from '../types/office';
import type { ClaudeInstance } from '../types/instance';
import type { CodexState } from '../types/codex';
import type { ChatMessage, PendingControlRequest, StreamResult } from '../types/stream';
import type { OpenCodeSnapshot } from '../types/opencode';
import type { ActivityRecord } from '../types/activity';

export const officeProvider = (instance: ClaudeInstance) => instance.config.llmConfig?.provider ?? instance.config.agentProvider ?? 'claude';
export const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', anthropic: 'Claude API', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama', lmstudio: 'LM Studio', openrouter: 'OpenRouter' };
export interface WorkSignal { activity: WorkerActivity; task: string; detail: string }
export function mapOfficeTool(name: string): WorkerActivity {
  const tool = name.toLowerCase();
  if (/askuser|request_user|permission/.test(tool)) return 'awaiting_permission';
  if (/web|browse|fetch|navigate/.test(tool)) return 'searching_web';
  if (/read|view_image/.test(tool)) return 'reading_file';
  if (/edit|patch|filechange/.test(tool)) return 'editing_file';
  if (/write(?!_stdin)/.test(tool) && !/todo/.test(tool)) return 'writing_file';
  if (/todo|plan/.test(tool)) return 'managing_todos';
  if (/grep|glob|search|find/.test(tool)) return 'searching_files';
  if (/bash|exec|shell|command|terminal|stdin|test/.test(tool)) return 'running_command';
  return 'using_tool';
}
export function rewardForTools(tools: string[]): number {
  const activities = new Set(tools.map(mapOfficeTool).filter(a => a !== 'awaiting_permission'));
  return 30 + Math.min(20, activities.size * 5);
}
export function cleanTask(text: string): string {
  return text.replace(/^\[panel-message[^\n]*\]\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}
const signal = (activity: WorkerActivity, task = '', detail = ''): WorkSignal => ({ activity, task: cleanTask(task), detail: detail.slice(0, 140) });
export function claudeSignal(session?: { messages: ChatMessage[]; isStreaming: boolean; error: string | null; controlRequests: PendingControlRequest[]; result: StreamResult | null }): WorkSignal {
  if (!session) return signal('unknown');
  const question = [...session.messages].reverse().find(m => m.role === 'user' && 'text' in m);
  const task = question && 'text' in question ? question.text : '';
  if (session.controlRequests.length) return signal('awaiting_permission', task, session.controlRequests[0].request.tool_name ?? 'Your input is needed');
  if (session.error) return signal('error', task, session.error);
  if (!session.isStreaming) return signal(session.result?.is_error || (session.result && session.result.subtype !== 'success') ? 'error' : 'idle', task);
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (message.role === 'user' && 'text' in message) break;
    if (!('blocks' in message) || message.role !== 'assistant') continue;
    const block = message.blocks.at(-1);
    if (block?.type === 'tool_use') return signal(mapOfficeTool(block.name), task, block.name);
    if (block?.type === 'thinking') return signal('thinking', task);
    if (block?.type === 'text') return signal('responding', task);
  }
  return signal('thinking', task);
}
export function codexSignal(session?: CodexState): WorkSignal {
  if (!session) return signal('unknown');
  const question = [...session.items].reverse().find(i => i.type === 'userMessage');
  const task = question?.content?.map(c => c.text ?? '').join(' ') ?? '';
  if (session.requests.length) return signal('awaiting_permission', task, 'Your input is needed');
  if (!session.connected) return signal('unknown', task, 'Disconnected');
  if (session.error) return signal('error', task, session.error);
  if (!session.busy) return signal('idle', task);
  const item = session.items.at(-1);
  if (!item || item.type === 'userMessage') return signal('thinking', task);
  if (item.type === 'reasoning') return signal('thinking', task);
  if (item.type === 'agentMessage') return signal('responding', task);
  if (item.type === 'commandExecution') return signal('running_command', task, item.command ?? 'Running command');
  if (item.type === 'fileChange') return signal('editing_file', task, item.changes?.map(c => c.path).join(', ') ?? 'Editing files');
  if (item.type === 'webSearch') return signal('searching_web', task, 'Web search');
  if (item.type === 'plan') return signal('managing_todos', task);
  return signal(mapOfficeTool(String(item.tool ?? item.type)), task, String(item.tool ?? item.type));
}
export function openCodeSignal(session?: OpenCodeSnapshot): WorkSignal {
  if (!session) return signal('unknown');
  const question = [...session.messages].reverse().find(m => m.info.role === 'user');
  const task = question?.parts.map(p => p.text ?? '').join(' ') ?? '';
  if (session.permissions.length || session.questions.length) return signal('awaiting_permission', task);
  if (!session.connected) return signal('unknown', task);
  if (session.error || session.status.type === 'retry') return signal('error', task, session.error ?? session.status.message);
  if (session.status.type === 'idle') return signal('idle', task);
  const part = session.messages.at(-1)?.parts.at(-1);
  return signal(part?.type === 'tool' ? mapOfficeTool(part.tool ?? '') : part?.type === 'reasoning' ? 'thinking' : 'responding', task, part?.state?.title ?? part?.tool);
}
export function recordedSignal(record: ActivityRecord | undefined, now = Date.now()): WorkSignal {
  if (!record) return signal('unknown', '', 'No structured activity has been reported');
  if (record.status === 'completed') return signal('idle', record.prompt);
  if (record.status === 'failed' || record.status === 'interrupted') return signal('error', record.prompt, record.status);
  if (now - record.updatedAt > 30000) return signal('unknown', record.prompt, 'Waiting for the next reported action');
  return signal(record.currentTool ? mapOfficeTool(record.currentTool) : 'thinking', record.prompt, record.currentTool ?? 'Latest reported activity');
}
