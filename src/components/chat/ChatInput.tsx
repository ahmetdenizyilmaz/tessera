import React, { useRef, useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ImageChip } from './ImageChip';
import { FileMentionPopup } from './FileMentionPopup';
import { SlashCommandPopup } from './SlashCommandPopup';
import { QueueDisplay } from './QueueDisplay';
import { useProjectFiles } from '../../hooks/useProjectFiles';
import { useInstanceStore } from '../../store/instanceStore';

const LINE_HEIGHT = 20;
const MIN_LINES = 1;
const MAX_LINES = 8;
const MIN_HEIGHT = LINE_HEIGHT * MIN_LINES + 20; // padding
const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES + 20;

// Module-level draft store — persists across view-mode switches (chat <-> terminal)
const draftStore = new Map<string, string>();

// Module-level slash command cache — load once per cwd, instant popup on first use
const MAX_SLASH_CACHE_SIZE = 20;
const slashCommandCacheMap = new Map<string, Array<{ name: string; description: string; scope: string }>>();
const FALLBACK_SLASH_COMMANDS = [
  { name: '/help', description: 'Show help and available commands', scope: 'builtin' },
  { name: '/clear', description: 'Clear conversation history and free context', scope: 'builtin' },
  { name: '/compact', description: 'Compact conversation to save context', scope: 'builtin' },
  { name: '/config', description: 'View or modify Claude Code configuration', scope: 'builtin' },
  { name: '/cost', description: 'Show token usage and cost for this session', scope: 'builtin' },
  { name: '/usage', description: 'View token usage for the current billing month', scope: 'builtin' },
  { name: '/model', description: 'Set or switch the AI model', scope: 'builtin' },
  { name: '/status', description: 'Show account and system status', scope: 'builtin' },
  { name: '/review', description: 'Ask Claude to do a code review', scope: 'builtin' },
  { name: '/init', description: 'Initialize project by creating CLAUDE.md', scope: 'builtin' },
  { name: '/memory', description: 'Edit CLAUDE.md memory files', scope: 'builtin' },
  { name: '/permissions', description: 'View or update tool permissions', scope: 'builtin' },
  { name: '/doctor', description: 'Check Claude Code installation health', scope: 'builtin' },
  { name: '/bug', description: 'Report a bug to Anthropic', scope: 'builtin' },
  { name: '/pr_comments', description: 'Get comments on the current pull request', scope: 'builtin' },
  { name: '/release-notes', description: 'View latest Claude Code release notes', scope: 'builtin' },
  { name: '/vim', description: 'Toggle vim keybindings mode', scope: 'builtin' },
  { name: '/terminal-setup', description: 'Install Shift+Enter key binding for newlines', scope: 'builtin' },
  { name: '/login', description: 'Switch Anthropic accounts', scope: 'builtin' },
  { name: '/logout', description: 'Logout from your Anthropic account', scope: 'builtin' },
];

/** Call when an instance is permanently closed to free the draft memory. */
export function clearInstanceDraft(instanceId: string): void {
  draftStore.delete(instanceId);
  draftListeners.delete(instanceId);
}

// Mounted inputs register here so external sources (file drops) can append
// text to the right panel's composer.
const draftListeners = new Map<string, (value: string) => void>();

/** Append text to a panel's composer, adding a separating space if needed. */
export function insertIntoDraft(instanceId: string, text: string): void {
  const current = draftStore.get(instanceId) ?? '';
  const needsSpace = current.length > 0 && !/\s$/.test(current);
  const next = current + (needsSpace ? ' ' : '') + text;
  draftStore.set(instanceId, next);
  draftListeners.get(instanceId)?.(next);
}

interface PendingImage {
  path: string;
  previewUrl: string;
  filename: string;
}

interface QueuedMessage {
  id: string;
  text: string;
  images?: string[];
  timestamp: number;
}

interface ChatInputProps {
  instanceId: string;
  onSend: (text: string, images?: string[]) => void;
  isReady: boolean;
  isStreaming?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ instanceId, onSend, isReady, isStreaming }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => draftStore.get(instanceId) ?? '');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);

  // @ mention state
  const [mentionState, setMentionState] = useState<{
    active: boolean;
    query: string;
    selectedIndex: number;
    startPos: number;
  }>({ active: false, query: '', selectedIndex: 0, startPos: 0 });
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([]);

  // / slash command state
  const [slashState, setSlashState] = useState<{
    active: boolean;
    query: string;
    selectedIndex: number;
  }>({ active: false, query: '', selectedIndex: 0 });
  const [slashCommands, setSlashCommands] = useState<Array<{ name: string; description: string; scope: string }>>([]);

  // Get project cwd for file search
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const cwd = instance?.config?.cwd ?? '';
  const { files: mentionFiles, search: searchFiles, clear: clearFiles } = useProjectFiles(cwd);

  // Auto-grow textarea
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(Math.max(ta.scrollHeight, MIN_HEIGHT), MAX_HEIGHT) + 'px';
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const hasContent = value.trim().length > 0 || images.length > 0;
  const canSend = hasContent && !isSaving;

  // Auto-execute queued messages when streaming finishes
  useEffect(() => {
    if (!isStreaming && messageQueue.length > 0) {
      const [next, ...rest] = messageQueue;
      setMessageQueue(rest);
      onSend(next.text, next.images);
    }
  }, [isStreaming, messageQueue, onSend]);

  // Pre-load slash commands on mount so popup is instant on first use
  useEffect(() => {
    const key = cwd || '__no_cwd__';
    if (slashCommandCacheMap.has(key)) {
      setSlashCommands(slashCommandCacheMap.get(key)!);
      return;
    }
    invoke<Array<{ name: string; description: string; scope: string }>>('list_slash_commands', { cwd })
      .then((cmds) => {
        if (slashCommandCacheMap.size >= MAX_SLASH_CACHE_SIZE) {
          const oldest = slashCommandCacheMap.keys().next().value;
          if (oldest !== undefined) slashCommandCacheMap.delete(oldest);
        }
        slashCommandCacheMap.set(key, cmds);
        setSlashCommands(cmds);
      })
      .catch(() => {
        if (slashCommandCacheMap.size >= MAX_SLASH_CACHE_SIZE) {
          const oldest = slashCommandCacheMap.keys().next().value;
          if (oldest !== undefined) slashCommandCacheMap.delete(oldest);
        }
        slashCommandCacheMap.set(key, FALLBACK_SLASH_COMMANDS);
        setSlashCommands(FALLBACK_SLASH_COMMANDS);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const trimmed = value.trim();

    let message = trimmed;

    // Prepend mentioned files
    if (mentionedFiles.length > 0) {
      const mentions = mentionedFiles.map(f => `@${f}`).join(' ');
      message = `${mentions}\n${message}`;
    }

    // Images travel as real content blocks (base64) via the Rust side —
    // never as a literal "[Images: path]" text tag.
    const imagePaths = images.length > 0 ? images.map((img) => img.path) : undefined;

    if (isStreaming) {
      // Queue message
      setMessageQueue(prev => [...prev, { id: crypto.randomUUID(), text: message, images: imagePaths, timestamp: Date.now() }]);
    } else {
      onSend(message, imagePaths);
    }
    setValue('');
    draftStore.delete(instanceId);
    setImages([]);
    setMentionedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = MIN_HEIGHT + 'px';
    }
  }, [canSend, value, images, onSend, instanceId, isStreaming, mentionedFiles]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (newValue) draftStore.set(instanceId, newValue);
    else draftStore.delete(instanceId);

    const cursorPos = e.target.selectionStart;

    // Check for @ mention trigger
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      const query = atMatch[1];
      setMentionState({ active: true, query, selectedIndex: 0, startPos: cursorPos - query.length - 1 });
      searchFiles(query);
      setSlashState(s => ({ ...s, active: false }));
      return;
    } else if (mentionState.active) {
      setMentionState(s => ({ ...s, active: false }));
      clearFiles();
    }

    // Check for / slash command trigger (only while typing the command name —
    // close the popup as soon as a space is typed)
    if (newValue.startsWith('/') && !newValue.includes(' ')) {
      const query = newValue.slice(1);
      setSlashState({ active: true, query, selectedIndex: 0 });
      setMentionState(s => ({ ...s, active: false }));
      return;
    }
    if (slashState.active) {
      setSlashState(s => ({ ...s, active: false }));
    }
  }, [instanceId, mentionState.active, slashState.active, searchFiles, clearFiles]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle @ mention navigation
      if (mentionState.active && mentionFiles.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionState(s => ({ ...s, selectedIndex: Math.min(s.selectedIndex + 1, mentionFiles.length - 1) }));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionState(s => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) }));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const file = mentionFiles[mentionState.selectedIndex];
          if (file) selectMentionFile(file);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionState(s => ({ ...s, active: false }));
          clearFiles();
          return;
        }
      }

      // Handle / command navigation
      if (slashState.active && filteredSlashCommands.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashState(s => ({ ...s, selectedIndex: Math.min(s.selectedIndex + 1, filteredSlashCommands.length - 1) }));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashState(s => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) }));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const cmd = filteredSlashCommands[slashState.selectedIndex];
          if (cmd) selectSlashCommand(cmd);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashState(s => ({ ...s, active: false }));
          return;
        }
      }

      // isComposing guard: on Turkish dead-key (â, î, û) and CJK IME
      // composition, Enter commits the composed character — it must not send.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mentionState, mentionFiles, slashState],
  );

  const selectMentionFile = useCallback((file: { path: string }) => {
    // Replace @query with @path in the textarea value
    const before = value.slice(0, mentionState.startPos);
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const after = value.slice(cursorPos);
    const newValue = `${before}@${file.path} ${after}`;
    setValue(newValue);
    draftStore.set(instanceId, newValue);
    setMentionedFiles(prev => [...prev, file.path]);
    setMentionState({ active: false, query: '', selectedIndex: 0, startPos: 0 });
    clearFiles();
    textareaRef.current?.focus();
  }, [value, mentionState.startPos, instanceId, clearFiles]);

  const selectSlashCommand = useCallback((cmd: { name: string }) => {
    setValue(cmd.name + ' ');
    draftStore.set(instanceId, cmd.name + ' ');
    setSlashState({ active: false, query: '', selectedIndex: 0 });
    textareaRef.current?.focus();
  }, [instanceId]);

  // Filter slash commands by query
  const filteredSlashCommands = slashCommands.filter(c =>
    !slashState.query || c.name.toLowerCase().includes(slashState.query.toLowerCase()) ||
    c.description.toLowerCase().includes(slashState.query.toLowerCase())
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;

      e.preventDefault();
      setIsSaving(true);

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;

        const ext = item.type.split('/')[1] ?? 'png';
        const filename = `img_${Date.now()}.${ext}`;

        try {
          const buffer = await file.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));

          const diskPath = await invoke<string>('save_chat_image', {
            data: bytes,
            projectDir: '',
            ext,
          });

          const previewUrl = URL.createObjectURL(file);
          setImages((prev) => [...prev, { path: diskPath, previewUrl, filename }]);
        } catch (err) {
          console.error('Failed to save pasted image:', err);
        }
      }

      setIsSaving(false);
    },
    [],
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setIsSaving(true);
    for (const file of imageFiles) {
      const ext = file.name.split('.').pop() ?? 'png';
      const filename = file.name || `img_${Date.now()}.${ext}`;
      try {
        const buffer = await file.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));
        const diskPath = await invoke<string>('save_chat_image', {
          data: bytes,
          projectDir: '',
          ext,
        });
        const previewUrl = URL.createObjectURL(file);
        setImages((prev) => [...prev, { path: diskPath, previewUrl, filename }]);
      } catch (err) {
        console.error('Failed to save dropped image:', err);
      }
    }
    setIsSaving(false);
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const removeQueuedMessage = useCallback((id: string) => {
    setMessageQueue(prev => prev.filter(m => m.id !== id));
  }, []);

  const clearQueue = useCallback(() => {
    setMessageQueue([]);
  }, []);

  // Let external sources (dropped files) append into this composer
  useEffect(() => {
    draftListeners.set(instanceId, (next) => {
      setValue(next);
      textareaRef.current?.focus();
    });
    return () => {
      draftListeners.delete(instanceId);
    };
  }, [instanceId]);

  // Cleanup draft on unmount (instance closed)
  useEffect(() => {
    return () => {
      draftStore.delete(instanceId);
    };
  }, [instanceId]);

  // Focus textarea when ready
  useEffect(() => {
    if (isReady) {
      textareaRef.current?.focus();
    }
  }, [isReady]);

  return (
    <div
      className={`chat-input-area ${isDragging ? 'chat-input-area--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Mentioned files chips */}
      {mentionedFiles.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 10px 0' }}>
          {mentionedFiles.map((f, i) => (
            <span key={`${f}-${i}`} className="file-mention-chip">
              @{f}
              <button
                onClick={() => setMentionedFiles(prev => prev.filter((_, idx) => idx !== i))}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: '0 0 0 4px', fontSize: 12, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="image-chips">
          {images.map((img, i) => (
            <ImageChip
              key={img.path}
              src={img.previewUrl}
              name={img.filename}
              onRemove={() => removeImage(i)}
            />
          ))}
        </div>
      )}
      <div className="chat-input-row" style={{ position: 'relative' }}>
        {/* @ File mention popup */}
        <FileMentionPopup
          files={mentionFiles}
          selectedIndex={mentionState.selectedIndex}
          onSelect={selectMentionFile}
          visible={mentionState.active}
        />
        {/* / Slash command popup */}
        <SlashCommandPopup
          commands={filteredSlashCommands}
          selectedIndex={slashState.selectedIndex}
          onSelect={selectSlashCommand}
          visible={slashState.active}
        />
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onInput={adjustHeight}
          placeholder={
            messageQueue.length > 0
              ? `${messageQueue.length} message${messageQueue.length > 1 ? 's' : ''} queued\u2026 will send when Claude finishes`
              : isStreaming
                ? 'Type your next message\u2026 (will queue until Claude finishes)'
                : 'Message Claude\u2026 (Enter to send, @ for files, / for commands)'
          }
          rows={1}
          style={{ height: MIN_HEIGHT + 'px' }}
        />
        <button
          className={`chat-send-btn ${canSend ? 'chat-send-btn--active' : ''}`}
          onClick={handleSend}
          disabled={!canSend}
          title="Send (Enter)"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8L14 2L8 14L7 9L2 8Z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {/* Queue display */}
      <QueueDisplay
        queue={messageQueue}
        onRemove={removeQueuedMessage}
        onClear={clearQueue}
      />
      {isSaving && <div className="chat-input-saving">Saving image&hellip;</div>}
    </div>
  );
};
