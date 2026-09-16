import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useWizardStore } from '../store/wizardStore';
import { useChatStore } from '../store/chatStore';
import { useCodexStore } from '../store/codexStore';
import { useLlmChatStore } from '../store/llmChatStore';
import { canAddPanel, notifyPanelLimit } from '../store/layoutStore';
import { notify } from './toast';
import { openNewSessionWizard } from './newSessionActions';
import { historyItems } from './codexReducer';
import {
  claudeMessagesToMessages,
  codexItemsToMessages,
  normalizeAlternation,
  plainToMessages,
  renderForkContext,
} from './forkTranscript';
import type { CodexThread } from '../types/codex';
import type { ClaudeInstance, ForkContext, ForkMessage } from '../types/instance';

/** Transcript budget for terminal targets that pass it on the command line. */
const FORK_TERMINAL_MAX_CHARS = 12_000;

/** Transcripts captured by startFork, waiting for the wizard to create the target panel. */
const pendingForks = new Map<string, ForkMessage[]>();

function providerLabel(inst: ClaudeInstance | undefined): string {
  if (!inst) return 'unknown';
  if (inst.config.llmConfig) return inst.config.llmConfig.provider;
  return inst.config.agentProvider ?? 'claude';
}

/** The conversation of any chat-capable panel, newest last. Empty when there is nothing yet. */
export async function collectTranscript(instanceId: string): Promise<ForkMessage[]> {
  const inst = useInstanceStore.getState().instances.get(instanceId);
  if (!inst) return [];

  if (inst.config.llmConfig) {
    const rows = useLlmChatStore.getState().getConversation(instanceId).messages.filter((m) => !m.isStreaming);
    return plainToMessages(rows);
  }

  if (inst.config.agentProvider === 'codex') {
    const live = codexItemsToMessages(useCodexStore.getState().sessions[instanceId]?.items ?? []);
    if (live.length || !inst.codexThreadId || inst.codexHasTurns === false) return live;
    const result = await invoke<CodexThread | { thread: CodexThread }>('codex_read_thread', {
      threadId: inst.codexThreadId,
      executablePath: inst.config.codex?.executablePath || null,
    });
    const thread = 'thread' in result && result.thread ? result.thread : (result as CodexThread);
    return codexItemsToMessages(historyItems(thread));
  }

  const live = claudeMessagesToMessages(useChatStore.getState().sessions.get(instanceId)?.messages ?? []);
  if (live.length || !inst.claudeSessionId || !inst.config.cwd) return live;
  const rows = await invoke<Array<{ role: string; content: string; timestamp?: string | null }>>('session_load_history', {
    sessionId: inst.claudeSessionId,
    projectPath: inst.config.cwd,
  }).catch(() => []);
  return plainToMessages(rows ?? []);
}

/**
 * Fork button entry point: capture the source panel's conversation and open the
 * new-session wizard in fork mode so the user picks the target provider.
 */
export async function startFork(sourceId: string): Promise<void> {
  const inst = useInstanceStore.getState().instances.get(sourceId);
  if (!inst) return;
  if (!canAddPanel()) { notifyPanelLimit(); return; }
  let transcript: ForkMessage[];
  try {
    transcript = await collectTranscript(sourceId);
  } catch (err) {
    notify(`Could not read this panel's history: ${String(err)}`);
    return;
  }
  if (transcript.length === 0) {
    notify('Nothing to fork yet. Send a message first so there is a conversation to carry over.');
    return;
  }
  pendingForks.set(sourceId, transcript);
  openNewSessionWizard();
  useWizardStore.getState().set({
    fork: { sourceId, sourceName: inst.name, messageCount: transcript.length },
    cwd: inst.config.cwd && inst.config.cwd !== '.' ? inst.config.cwd : useWizardStore.getState().cwd,
    panelView: 'chat',
    lanMode: false,
    route: null,
    routeModel: '',
    keyEntryFor: null,
  });
}

/** Leave fork mode without creating anything. */
export function cancelFork(): void {
  const fork = useWizardStore.getState().fork;
  if (!fork) return;
  pendingForks.delete(fork.sourceId);
  useWizardStore.getState().set({ fork: null });
}

/**
 * Called right after the wizard added instance `newId` and before its panel
 * mounts. Attaches the captured transcript to the new instance and paints it
 * into the panel. LLM chats get the messages as real turns (they resend the
 * whole array), so nothing is pending for them; Claude Code and Codex carry the
 * context on the first send instead.
 */
export function applyForkToInstance(newId: string): void {
  const fork = useWizardStore.getState().fork;
  if (!fork) return;
  const transcript = pendingForks.get(fork.sourceId);
  pendingForks.delete(fork.sourceId);
  useWizardStore.getState().set({ fork: null });
  if (!transcript || transcript.length === 0) return;

  const store = useInstanceStore.getState();
  const inst = store.instances.get(newId);
  if (!inst) return;
  const source = store.instances.get(fork.sourceId);
  const isLlm = !!inst.config.llmConfig;
  // A Claude Code terminal is a raw PTY from the start, so the transcript
  // goes in at spawn time (below). Codex terminals send their first message
  // through the composer before the terminal attaches, so they can carry the
  // transcript in that message like chat panels, where it stays visible.
  const isClaudeTerminal = !isLlm && inst.config.agentProvider !== 'codex' && inst.config.panelView === 'terminal';
  const context: ForkContext = {
    sourceId: fork.sourceId,
    sourceName: fork.sourceName,
    sourceProvider: providerLabel(source),
    transcript,
    pending: !isLlm && !isClaudeTerminal,
  };
  let systemPrompt = inst.config.systemPrompt;
  if (isClaudeTerminal) {
    // The CLI receives it via --append-system-prompt, kept short because
    // Windows command lines are capped at 32 KB.
    const block = renderForkContext(transcript, fork.sourceName, FORK_TERMINAL_MAX_CHARS);
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${block}` : block;
  }
  store.updateInstance(newId, {
    name: `Fork of ${fork.sourceName}`,
    config: { ...inst.config, systemPrompt, fork: context },
  });

  if (isLlm) {
    useLlmChatStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        [newId]: {
          isStreaming: false,
          error: null,
          messages: normalizeAlternation(transcript).map((m) => ({
            id: crypto.randomUUID(),
            role: m.role,
            content: m.content,
            timestamp: m.timestamp ? Date.parse(m.timestamp) || Date.now() : Date.now(),
          })),
        },
      },
    }));
  } else if (inst.config.agentProvider !== 'codex' && inst.config.panelView !== 'terminal') {
    useChatStore.getState().seedHistory(newId, transcript);
  }
  // Codex panels render config.fork.transcript themselves (CodexPanel).
}

/** The text to prepend to the first send of a forked panel, or null when nothing is pending. */
export function peekForkContext(instanceId: string): string | null {
  const fork = useInstanceStore.getState().instances.get(instanceId)?.config.fork;
  if (!fork?.pending) return null;
  return renderForkContext(fork.transcript, fork.sourceName);
}

/** Mark the fork context as delivered so later sends are plain. */
export function markForkConsumed(instanceId: string): void {
  const store = useInstanceStore.getState();
  const inst = store.instances.get(instanceId);
  if (!inst?.config.fork?.pending) return;
  store.updateInstance(instanceId, { config: { ...inst.config, fork: { ...inst.config.fork, pending: false } } });
}
