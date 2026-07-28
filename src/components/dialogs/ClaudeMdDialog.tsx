import React, { useState, useEffect, useCallback } from 'react';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';

interface ClaudeMdDialogProps {
  isOpen: boolean;
  onClose: () => void;
  cwd?: string;
}

export function ClaudeMdDialog({ isOpen, onClose, cwd }: ClaudeMdDialogProps) {
  const [tab, setTab] = useState<'project' | 'user'>('project');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [projectContent, setProjectContent] = useState('');
  const [userContent, setUserContent] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [userPath, setUserPath] = useState('');
  const [dirty, setDirty] = useState({ project: false, user: false });

  useEffect(() => {
    if (!isOpen) return;
    loadFiles();
  }, [isOpen, cwd]);

  const loadFiles = async () => {
    try {
      const home = await homeDir();

      // User CLAUDE.md
      const uPath = `${home}CLAUDE.md`;
      setUserPath(uPath);
      if (await exists(uPath)) {
        setUserContent(await readTextFile(uPath));
      } else {
        setUserContent('');
      }

      // Project CLAUDE.md
      if (cwd && cwd !== '.') {
        const pPath = `${cwd}/CLAUDE.md`;
        setProjectPath(pPath);
        if (await exists(pPath)) {
          setProjectContent(await readTextFile(pPath));
        } else {
          setProjectContent('');
        }
      }
    } catch (err) {
      console.warn('Failed to load CLAUDE.md files:', err);
    }
  };

  const handleSave = useCallback(async () => {
    try {
      if (dirty.project && projectPath) {
        await writeTextFile(projectPath, projectContent);
      }
      if (dirty.user && userPath) {
        await writeTextFile(userPath, userContent);
      }
      setDirty({ project: false, user: false });
    } catch (err) {
      console.error('Failed to save CLAUDE.md:', err);
    }
  }, [dirty, projectPath, projectContent, userPath, userContent]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, handleSave]);

  if (!isOpen) return null;

  const content = tab === 'project' ? projectContent : userContent;
  const setContent = tab === 'project' ? setProjectContent : setUserContent;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        style={{ width: '90vw', maxWidth: 900, height: '85vh', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 className="dialog-title">
            CLAUDE.md Editor
            {(dirty.project || dirty.user) && <span style={{ color: 'var(--warning)', marginLeft: 8, fontSize: 12 }}>unsaved</span>}
          </h2>
          <button className="dialog-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="dialog-tabs">
          <button className={`dialog-tab ${tab === 'project' ? 'dialog-tab-active' : ''}`} onClick={() => setTab('project')}>
            Project {dirty.project && '\u25CF'}
          </button>
          <button className={`dialog-tab ${tab === 'user' ? 'dialog-tab-active' : ''}`} onClick={() => setTab('user')}>
            User (~/.claude) {dirty.user && '\u25CF'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '8px 20px 0', borderBottom: '1px solid var(--border)' }}>
          <button className={`btn btn-sm ${mode === 'edit' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('edit')}>Edit</button>
          <button className={`btn btn-sm ${mode === 'preview' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('preview')}>Preview</button>
        </div>

        <div className="dialog-body" style={{ flex: 1, overflow: 'hidden', padding: 0 }}>
          {mode === 'edit' ? (
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(d => ({ ...d, [tab]: true }));
              }}
              style={{
                width: '100%',
                height: '100%',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: 'none',
                padding: 16,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                resize: 'none',
                outline: 'none',
              }}
              placeholder={`# ${tab === 'project' ? 'Project' : 'User'} CLAUDE.md\n\nAdd instructions here...`}
            />
          ) : (
            <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-primary)' }}>
                {content || 'No content'}
              </pre>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 'auto' }}>
            {tab === 'project' ? projectPath : userPath}
          </span>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!dirty.project && !dirty.user}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
