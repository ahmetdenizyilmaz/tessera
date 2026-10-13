import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FileText, Files, Folder, FolderOpen, Link2, X } from 'lucide-react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { extractPaths, openPath, resolvePath, type OpenedPath } from '../../lib/openPath';

function collectStrings(value: unknown, out: string[], budget: { left: number }, depth = 0) {
  if (depth > 6 || value == null || budget.left <= 0) return;
  if (typeof value === 'string') {
    const text = value.slice(0, Math.min(20000, budget.left));
    out.push(text); budget.left -= text.length; return;
  }
  if (Array.isArray(value)) { for (const item of value) collectStrings(item, out, budget, depth + 1); }
  else if (typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, out, budget, depth + 1);
}

/** Mounted only on demand: don't parse transcripts or probe files while hidden. */
function ResourceGrid({ items, cwd, onChoose }: { items: unknown[]; cwd: string; onChoose: () => void }) {
  const candidates = useMemo(() => {
    const strings: string[] = [];
    collectStrings(items.slice(-60).reverse(), strings, { left: 150000 });
    const text = strings.join('\n');
    return { paths: extractPaths(text).slice(0, 40), urls: [...new Set([...text.matchAll(/https?:\/\/[^\s"'<>)`\]]+/g)]
      .map(match => match[0].replace(/[.,;:]+$/, '')))].slice(0, 20) };
  }, [items]);
  const [paths, setPaths] = useState<Array<{ raw: string; target: OpenedPath }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const found: Array<{ raw: string; target: OpenedPath }> = [];
      for (let i = 0; i < candidates.paths.length && !cancelled; i += 4) {
        const batch = await Promise.all(candidates.paths.slice(i, i + 4).map(async raw => ({ raw, target: await resolvePath(raw, cwd) })));
        for (const hit of batch) if (hit.target && !found.some(p => p.target.path === hit.target!.path)) found.push({ raw: hit.raw, target: hit.target });
      }
      if (!cancelled) { setPaths(found); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [candidates, cwd]);
  const name = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
  return <>
    {loading && <p className="office-resource-empty" role="status">Checking local files…</p>}
    {!loading && !paths.length && !candidates.urls.length && <p className="office-resource-empty">No existing files, folders or web links in recent messages.</p>}
    <ul className="office-resource-grid">
      {paths.map(({ raw, target }) => <li key={target.path}><button title={target.path} onClick={() => { void openPath(raw, cwd); onChoose(); }}>
        {target.isDir ? <Folder size={20} /> : <FileText size={20} />}<span>{name(target.path)}</span><small>{target.isDir ? 'Folder' : 'File'}</small>
      </button></li>)}
      {candidates.urls.map(url => <li key={url}><button title={url} onClick={() => { void openExternal(url).catch(() => {}); onChoose(); }}>
        <Link2 size={20} /><span>{url.replace(/^https?:\/\//, '')}</span><small>Website</small>
      </button></li>)}
    </ul>
  </>;
}

export function OfficeResources({ items, cwd }: { items: unknown[]; cwd: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), popover = useRef<HTMLElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    popover.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); };
  }, [open]);
  return <div ref={root} className="office-resource-tools">
    <button ref={trigger} aria-label="Conversation resources" title="Files and links" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} className={open ? 'active' : ''} onClick={() => setOpen(value => !value)}><Files size={17} /></button>
    <button aria-label="Open agent working folder" title={cwd ? `Open working folder: ${cwd}` : 'No working folder'} disabled={!cwd} onClick={() => void openPath(cwd)}><FolderOpen size={17} /></button>
    {open && <section ref={popover} id={id} className="office-resource-popover" role="dialog" aria-label="Files and links" tabIndex={-1}>
      <div className="office-resource-heading"><strong>Files & links</strong><button aria-label="Close resources" onClick={close}><X size={15} /></button></div>
      <ResourceGrid items={items} cwd={cwd} onChoose={close} />
    </section>}
  </div>;
}
