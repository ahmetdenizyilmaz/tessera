/**
 * Clickable file and folder paths in agent chats.
 *
 * Agents write the same folder three ways: absolute, relative to the panel's
 * working folder, or shortened to something under the Desktop or home. Rust
 * (`open_path_smart`) tries each base and opens the first that exists; this
 * module decides what *looks* like a path and routes clicks there.
 */
import { createContext, useContext } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { findAndReplace } from 'mdast-util-find-and-replace';
import type { Root } from 'mdast';
import { notify } from './toast';
import { findPathReferences, PATH_TOKENS, trimPath } from './pathDetection';
export { looksLikePath } from './pathDetection';

export interface OpenedPath { path: string; isDir: boolean; base: string }

/** `path:` links carry the text as written; react-markdown would otherwise drop the scheme. */
export const PATH_SCHEME = 'path:';

/** The folder the panel (or the chat shown in the office) works in. */
export const PathCwdContext = createContext<string | null | undefined>(undefined);
export function useChatCwd() { return useContext(PathCwdContext); }

/** Paths mentioned in a message, de-duplicated and in order of appearance. */
export function extractPaths(text: string): string[] {
  return [...new Set(findPathReferences(text).map(reference => reference.path))];
}

/** remark plugin: path references in prose become `path:` links. Text inside
 * links and inline code is left alone (inline code is handled by the renderer). */
export function remarkPaths() {
  return (tree: Root) => {
    findAndReplace(tree, [[new RegExp(PATH_TOKENS.source, PATH_TOKENS.flags), (match: string) => {
      const path = findPathReferences(match)[0]?.path;
      if (!path) return false;
      return { type: 'link', url: PATH_SCHEME + encodeURIComponent(path), children: [{ type: 'text', value: match }] };
    }]], { ignore: ['link', 'linkReference', 'inlineCode'] });
  };
}

/** Read-only lookup for link detection. Opening checks the path again. */
export async function resolvePath(raw: string, cwd?: string): Promise<OpenedPath | null> {
  return invoke<OpenedPath | null>('resolve_path_smart', { path: raw, cwd: cwd ?? null }).catch(() => null);
}

/** Open the first existing match in the file manager; say so when nothing matched. */
export async function openPath(raw: string, cwd?: string): Promise<OpenedPath | null> {
  const path = trimPath(raw);
  try {
    const opened = await invoke<OpenedPath | null>('open_path_smart', { path, cwd: cwd ?? null });
    if (!opened) notify(`Nothing at "${path}" — looked in the panel folder, Desktop, home and each drive.`);
    return opened;
  } catch (e) {
    notify(`Could not open "${path}": ${String(e)}`);
    return null;
  }
}
