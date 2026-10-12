import React, { useCallback, useEffect, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import AnsiToHtml from 'ansi-to-html';
import { open } from '@tauri-apps/plugin-shell';
import type { Components } from 'react-markdown';
import { looksLikePath, openPath, resolvePath, PATH_SCHEME, remarkPaths, useChatCwd, type OpenedPath } from '../../lib/openPath';

const ansiConverter = new AnsiToHtml({
  fg: '#e0e0e0',
  bg: 'transparent',
  newline: true,
  escapeXML: true,
});

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/** Extract plain text from React children (for copy button) */
function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (React.isValidElement(children)) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>;
    return extractText(el.props.children);
  }
  return '';
}

function LocalPathLink({ path, cwd, inline, children }: {
  path: string; cwd: string | null | undefined; inline?: boolean; children: React.ReactNode;
}) {
  const [target, setTarget] = useState<OpenedPath | null>(null);
  useEffect(() => {
    let active = true;
    setTarget(null);
    if (cwd !== null) void resolvePath(path, cwd).then(found => { if (active) setTarget(found); });
    return () => { active = false; };
  }, [path, cwd]);
  const Tag = inline ? 'code' : 'span';
  return <Tag className={`${inline ? 'md-inline-code' : ''}${target ? ' md-link md-path' : ''}`}
    role={target ? 'link' : undefined} tabIndex={target ? 0 : undefined}
    title={target ? `${target.isDir ? 'Open folder' : 'Show file in folder'}: ${target.path}` : undefined}
    data-path={target ? path : undefined}
    onClick={target && cwd !== null ? () => void openPath(path, cwd) : undefined}
    onKeyDown={target && cwd !== null ? e => { if (e.key === 'Enter') { e.preventDefault(); void openPath(path, cwd); } } : undefined}>
    {children}
  </Tag>;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  const cwd = useChatCwd();
  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const href = e.currentTarget.getAttribute('href') ?? '';
    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault();
      open(href).catch(() => {});
    }
  }, []);

  const components: Components = {
    // pre: render a fragment to avoid nesting issues; code handles the wrapper
    pre({ children }) {
      return <>{children}</>;
    },

    // code: handles both inline and block code
    code({ className: cls, children, ...props }) {
      const hasLanguage = cls?.includes('language-');
      const text = extractText(children);

      // Inline code; a path opens its folder (or reveals the file) on click.
      if (!hasLanguage) {
        if (looksLikePath(text, true)) {
          return <LocalPathLink path={text.trim()} cwd={cwd} inline>{children}</LocalPathLink>;
        }
        return (
          <code className="md-inline-code" {...props}>
            {children}
          </code>
        );
      }

      // Block code
      const lang = cls?.replace('language-', '').split(' ')[0] ?? 'code';
      const hasAnsi = /\x1b\[/.test(text);

      return (
        <div className="md-code-block">
          <div className="md-code-header">
            <span className="md-code-lang">{lang}</span>
            <button
              className="md-code-copy"
              onClick={() => navigator.clipboard.writeText(text.replace(/\n$/, '')).catch(() => {})}
              type="button"
            >
              Copy
            </button>
          </div>
          {hasAnsi ? (
            <code
              className={cls}
              dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(text) }}
            />
          ) : (
            <code className={cls} {...props}>
              {children}
            </code>
          )}
        </div>
      );
    },

    // Wrap tables in a scrollable container
    table({ children }) {
      return (
        <div className="md-table-wrapper">
          <table className="md-table">{children}</table>
        </div>
      );
    },

    // Links open in the browser; `path:` links open the file manager.
    a({ href, children }) {
      const isPath = href?.startsWith(PATH_SCHEME);
      if (isPath) {
        let path: string;
        try { path = decodeURIComponent(href!.slice(PATH_SCHEME.length)); } catch { return <>{children}</>; }
        return <LocalPathLink path={path} cwd={cwd}>{children}</LocalPathLink>;
      }
      return (
        <a href={href} onClick={handleLinkClick} className="md-link" rel="noreferrer">
          {children}
        </a>
      );
    },

    // Images in markdown content
    img({ src, alt }) {
      if (!src) return null;
      return <img src={src} alt={alt ?? ''} className="md-image" loading="lazy" />;
    },

    // Blockquotes
    blockquote({ children }) {
      return <blockquote className="md-blockquote">{children}</blockquote>;
    },
  };

  return (
    <div className={`markdown-content ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkPaths]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={(url, key) => key === 'href' && !url.startsWith('#') && (url.startsWith(PATH_SCHEME) || looksLikePath(url, true))
          ? url.startsWith(PATH_SCHEME) ? url : PATH_SCHEME + encodeURIComponent(url)
          : defaultUrlTransform(url)}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
