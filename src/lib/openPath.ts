/**
 * Clickable file and folder paths in agent chats.
 *
 * Agents write folders as absolute paths, relative to the panel's working
 * folder, with a project-name prefix, or shortened under the Desktop or home. Rust
 * (`open_path_smart`) tries each base and opens the first that exists; this
 * module decides what *looks* like a path and routes clicks there.
 */
import { createContext, useContext } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Nodes, Parents, Root } from 'mdast';
import { notify } from './toast';
import { findPathReferences, trimPath } from './pathDetection';
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
    const walk = (parent: Parents) => {
      const children = parent.children as Nodes[];
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.type !== 'text') {
          if ('children' in node && node.type !== 'link' && node.type !== 'linkReference') walk(node);
          continue;
        }
        // Scan each text node once. find-and-replace retries rejected matches
        // one UTF-16 unit later; with /u that can move backwards into an emoji's
        // surrogate pair and loop forever. It also links suffixes of non-paths.
        const references = findPathReferences(node.value);
        if (!references.length) continue;
        const replacement: Nodes[] = [];
        let end = 0;
        for (const reference of references) {
          if (reference.start > end) replacement.push({ type: 'text', value: node.value.slice(end, reference.start) });
          replacement.push({ type: 'link', url: PATH_SCHEME + encodeURIComponent(reference.path), children: [{ type: 'text', value: node.value.slice(reference.start, reference.end) }] });
          end = reference.end;
        }
        if (end < node.value.length) replacement.push({ type: 'text', value: node.value.slice(end) });
        children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
      }
    };
    walk(tree);
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
