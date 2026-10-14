import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Keyboard, Search, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { BUILD_LABEL, buildDateLabel } from '../../lib/buildInfo';
import './about.css';

interface AboutDialogProps { isOpen: boolean; onClose: () => void }

const SHORTCUTS: { key: string; label: string }[] = [
  { key: 'F11', label: 'Maximize / Restore Focused Panel' },
  { key: 'Ctrl+Z', label: 'Undo Panel Close / Resize (outside text inputs)' },
  { key: 'Ctrl+Y', label: 'Redo Panel Close / Resize (outside text inputs)' },
  { key: 'Alt+0–9', label: 'Assign Number to Focused Panel' },
  { key: 'Ctrl+0–9', label: 'Focus Assigned Panel' },
  { key: 'Hold Ctrl', label: 'Show Panel Shortcut Numbers' },
  { key: 'Hold Alt', label: 'Show Red Shortcut Assignment Labels' },
  { key: 'Ctrl+Tab', label: 'Next Panel' },
  { key: 'Ctrl+Shift+Tab', label: 'Previous Panel' },
  { key: 'Ctrl+N', label: 'New Instance (dialog)' },
  { key: 'Ctrl+Shift+N', label: 'Quick Instance' },
  { key: 'Ctrl+S', label: 'Save Workspace' },
  { key: 'Ctrl+O', label: 'Load Workspace' },
  { key: 'Ctrl+G', label: 'Toggle Office View' },
  { key: 'Ctrl+M', label: 'CLAUDE.md Editor' },
  { key: 'Ctrl+,', label: 'Settings' },
  { key: 'Escape', label: 'Close Dialog' },
];

export const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose }) => {
  const ref = useRef<HTMLDivElement>(null), [search,setSearch] = useState(''), [linkError,setLinkError] = useState('');
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    setSearch(''); setLinkError(''); ref.current?.focus();
    return () => { if(previous?.isConnected) previous.focus({preventScroll:true}); };
  }, [isOpen]);
  if (!isOpen) return null;
  const shortcuts = SHORTCUTS.filter(s=>`${s.key} ${s.label}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="dialog-overlay" data-browser-overlay onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div ref={ref} className="tessera-about" role="dialog" aria-modal="true" aria-labelledby="about-title" tabIndex={-1} onKeyDown={e=>{
      e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onClose();}
      if(e.key==='Tab'){const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button,input,a')];const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){e.preventDefault();first?.focus();}}
    }}>
      <header><div className="about-brand"><svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="5" width="15" height="30" rx="4" fill="#6781ff"/><rect x="22" y="5" width="15" height="13" rx="4" fill="#f1be5b"/><rect x="22" y="22" width="15" height="13" rx="4" fill="#71819b"/></svg><div><span className="about-eyebrow">Your work, together</span><h2 id="about-title">Tessera</h2></div></div><button type="button" className="about-close" aria-label="Close About" onClick={onClose}><X size={19}/></button></header>
      <div className="about-content">
        <div className="about-build"><span>{BUILD_LABEL}</span><small>Built {buildDateLabel()}</small></div>
        <p className="about-description">AI agents, terminals, and small apps in one flexible workspace. Arrange panels, keep conversations together, and make room for the way you work.</p>
        <div className="about-credit"><div><span>Created by</span><strong>Ahmet Deniz YILMAZ</strong></div><a href="https://ady.com.tr" onClick={e=>{e.preventDefault();void open('https://ady.com.tr').catch(()=>setLinkError('Could not open the browser. Visit ady.com.tr in your browser.'));}}>ady.com.tr<ExternalLink size={13}/></a></div>
        {linkError&&<p role="alert" className="about-link-error">{linkError}</p>}
        <section className="about-keys" aria-labelledby="about-keys-title"><div className="about-keys-heading"><h3 id="about-keys-title"><Keyboard size={16}/>Keyboard shortcuts</h3><label><Search size={13}/><input type="search" aria-label="Find a keyboard shortcut" placeholder="Find shortcut" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
          <div className="about-keys-scroll" tabIndex={0} role="region" aria-label="Browse keyboard shortcuts"><div className="about-keys-grid">{shortcuts.map(s=><div className="about-key" key={s.key}><kbd>{s.key}</kbd><span>{s.label}</span></div>)}</div>{!shortcuts.length&&<p className="about-empty">No matching shortcuts.</p>}</div>
        </section>
        <p className="about-note">An independent app. Provider names and trademarks belong to their respective owners.</p>
      </div>
      <footer><span>A little space for better work.</span><button className="btn btn-primary" type="button" onClick={onClose}>Done</button></footer>
    </div>
  </div>;
};
