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
import { useLayoutStore } from '../store/layoutStore';
import { useInstanceStore } from '../store/instanceStore';

export interface OpenedPath { path: string; isDir: boolean; base: string }

/** `path:` links carry the text as written; react-markdown would otherwise drop the scheme. */
export const PATH_SCHEME = 'path:';

/** Absolute Windows/POSIX paths and `~/` paths, as they appear in prose. Stops at
 * whitespace and the quote/bracket characters that end a path in a sentence. */
const ABSOLUTE = /(?:(?<![A-Za-z])[A-Za-z]:[\\/](?![\\/])|(?<!\S)~[\\/]|(?<!\S)\/(?:Users|home|mnt|opt|srv|var|etc|tmp)\/)[^\s"'<>|*?`()[\]{}]+/g;

/** The folder the panel (or the chat shown in the office) works in. */
export const PathCwdContext = createContext<string | undefined>(undefined);
export function useChatCwd(): string | undefined {
  const fromContext = useContext(PathCwdContext);
  const focused = useLayoutStore(s => s.focusedId);
  const cwd = useInstanceStore(s => focused ? s.instances.get(focused)?.config.cwd : undefined);
  return fromContext ?? cwd;
}

/** Is this inline-code text something a person would expect to open as a path?
 * Relative paths need a separator (`src/lib/x.ts`); a bare word is not a path. */
export function looksLikePath(text: string): boolean {
  const s = text.trim();
  if (!s || s.length > 400 || s.includes('://') || /\s{2,}|\n/.test(s)) return false;
  if (/^(?:[A-Za-z]:[\\/]|~[\\/]?$|~[\\/]|\\\\)/.test(s)) return true;
  if (!/[\\/]/.test(s) || /\s/.test(s)) return false;
  if (/^\d+[\\/]\d+(?:[\\/]\d+)?$/.test(s)) return false; // dates and fractions
  if (!/^(?:[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]*$/.test(s)) return false;
  const segments = s.split(/[\\/]/).filter(Boolean);
  // "and/or" is two words; a path shows itself through an extension, a dot
  // segment, a well-known folder, or a segment no sentence would contain.
  if (segments.length > 2 || /\.\w+$/.test(s) || /^\.\.?[\\/]/.test(s)) return true;
  if (COMMON_FOLDERS.has(segments[0])) return true;
  return segments.some(seg => /[_\-\d.A-Z]/.test(seg));
}

const COMMON_FOLDERS = new Set(['src', 'lib', 'docs', 'doc', 'tools', 'test', 'tests', 'app', 'apps', 'bin', 'build', 'dist', 'public', 'assets', 'components', 'pages', 'config', 'scripts', 'target', 'node_modules', 'Desktop', 'Documents', 'Downloads', 'Users', 'home', 'tmp', 'var', 'etc', 'opt', 'mnt']);

/** Paths mentioned in a message, de-duplicated and in order of appearance. */
export function extractPaths(text: string): string[] {
  const out: string[] = [];
  const add = (p: string) => { const t = trimPath(p); if (t && !out.includes(t)) out.push(t); };
  for (const m of text.matchAll(ABSOLUTE)) add(m[0]);
  for (const m of text.matchAll(/`([^`\n]+)`/g)) if (looksLikePath(m[1])) add(m[1]);
  return out;
}

function trimPath(p: string) { return p.trim().replace(/[.,;:]+$/, ''); }

/** remark plugin: absolute and `~/` paths in prose become `path:` links. Text inside
 * links and inline code is left alone (inline code is handled by the renderer). */
export function remarkPaths() {
  return (tree: Root) => {
    findAndReplace(tree, [[new RegExp(ABSOLUTE.source, 'g'), (match: string) => {
      const path = trimPath(match);
      if (!looksLikePath(path)) return false;
      return { type: 'link', url: PATH_SCHEME + encodeURIComponent(path), children: [{ type: 'text', value: match }] };
    }]], { ignore: ['link', 'linkReference', 'inlineCode'] });
  };
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
