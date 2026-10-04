import React, { useCallback } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import AnsiToHtml from 'ansi-to-html';
import { open } from '@tauri-apps/plugin-shell';
import type { Components } from 'react-markdown';
import { looksLikePath, openPath, PATH_SCHEME, remarkPaths, useChatCwd } from '../../lib/openPath';

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

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  const cwd = useChatCwd();
  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const href = e.currentTarget.getAttribute('href') ?? '';
    if (href.startsWith(PATH_SCHEME)) {
      e.preventDefault();
      void openPath(decodeURIComponent(href.slice(PATH_SCHEME.length)), cwd);
      return;
    }
    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault();
      open(href).catch(() => {});
    }
  }, [cwd]);

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
        if (looksLikePath(text)) {
          return (
            <code className="md-inline-code md-path" role="link" tabIndex={0} title="Open in file manager" data-path={text.trim()}
              onClick={() => void openPath(text, cwd)} onKeyDown={e => { if (e.key === 'Enter') void openPath(text, cwd); }} {...props}>
              {children}
            </code>
          );
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
      return (
        <a href={href} onClick={handleLinkClick} className={isPath ? 'md-link md-path' : 'md-link'} rel="noreferrer" title={isPath ? 'Open in file manager' : undefined}>
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
        urlTransform={url => url.startsWith(PATH_SCHEME) ? url : defaultUrlTransform(url)}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
