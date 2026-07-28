import { useState, useEffect, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ProjectInfo } from '../../store/projectStore';

interface ClaudeMdEditorProps {
  project: ProjectInfo;
  onClose: () => void;
}

type ViewMode = 'edit' | 'preview' | 'split';
type TabKind = 'project' | 'user';

export function ClaudeMdEditor({ project, onClose }: ClaudeMdEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [activeTab, setActiveTab] = useState<TabKind>('project');

  const [projectContent, setProjectContent] = useState('');
  const [userContent, setUserContent] = useState('');
  const [projectDirty, setProjectDirty] = useState(false);
  const [userDirty, setUserDirty] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const content = activeTab === 'project' ? projectContent : userContent;
  const dirty = activeTab === 'project' ? projectDirty : userDirty;
  const setContent = activeTab === 'project' ? setProjectContent : setUserContent;
  const setDirty = activeTab === 'project' ? setProjectDirty : setUserDirty;

  const getPath = useCallback(async (tab: TabKind) => {
    const homeDir = await import('@tauri-apps/api/path').then(m => m.homeDir());
    if (tab === 'project') {
      return `${homeDir}.claude/projects/${project.name}/CLAUDE.md`;
    }
    return `${homeDir}.claude/CLAUDE.md`;
  }, [project.name]);

  const loadContent = useCallback(async (tab: TabKind) => {
    setLoading(true);
    try {
      const path = await getPath(tab);
      const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
      if (await exists(path)) {
        const text = await readTextFile(path);
        if (tab === 'project') setProjectContent(text);
        else setUserContent(text);
      } else {
        const defaultText = tab === 'project'
          ? '# CLAUDE.md\n\nProject instructions for Claude.\n'
          : '# User CLAUDE.md\n\nUser-level instructions for Claude.\n';
        if (tab === 'project') setProjectContent(defaultText);
        else setUserContent(defaultText);
      }
    } catch (err) {
      console.error(`Failed to load ${tab} CLAUDE.md:`, err);
      const setter = tab === 'project' ? setProjectContent : setUserContent;
      setter('# Failed to load file');
    }
    setLoading(false);
  }, [getPath]);

  useEffect(() => {
    loadContent('project');
    loadContent('user');
  }, [project, loadContent]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const path = await getPath(activeTab);
      const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');

      const dir = path.replace(/\/[^/]+$/, '');
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
      }

      await writeTextFile(path, content);
      setDirty(false);
    } catch (err) {
      console.error('Failed to save CLAUDE.md:', err);
    }
    setSaving(false);
  }, [activeTab, content, getPath, setDirty]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    background: 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    cursor: 'pointer',
  });

  const viewBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer',
  });

  const textareaStyle: React.CSSProperties = {
    flex: 1,
    resize: 'none',
    border: 'none',
    outline: 'none',
    padding: 16,
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.6,
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    tabSize: 2,
    width: '100%',
    minHeight: 0,
  };

  const previewStyle: React.CSSProperties = {
    flex: 1,
    padding: 16,
    overflow: 'auto',
    fontSize: 13,
    lineHeight: 1.6,
    color: 'var(--text-primary)',
    background: 'var(--bg-primary)',
    minHeight: 0,
  };

  const renderEditor = () => (
    <textarea
      value={content}
      onChange={(e) => { setContent(e.target.value); setDirty(true); }}
      style={textareaStyle}
      spellCheck={false}
      onKeyDown={handleKeyDown}
    />
  );

  const renderPreview = () => (
    <div style={previewStyle} className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-surface)', borderRadius: 8,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* User / Project tabs */}
          <button style={tabBtnStyle(activeTab === 'user')} onClick={() => setActiveTab('user')}>
            User
          </button>
          <button style={tabBtnStyle(activeTab === 'project')} onClick={() => setActiveTab('project')}>
            Project
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
            {activeTab === 'project' ? project.path : '~/.claude/CLAUDE.md'}
          </span>
          {dirty && <span style={{ fontSize: 11, color: 'var(--warning)' }}>Modified</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* View mode toggles */}
          <div style={{ display: 'flex', gap: 2, marginRight: 8 }}>
            <button style={viewBtnStyle(viewMode === 'edit')} onClick={() => setViewMode('edit')}>
              Edit
            </button>
            <button style={viewBtnStyle(viewMode === 'preview')} onClick={() => setViewMode('preview')}>
              Preview
            </button>
            <button style={viewBtnStyle(viewMode === 'split')} onClick={() => setViewMode('split')}>
              Split
            </button>
          </div>

          <button
            className="btn btn-sm btn-primary"
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Save size={12} />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content area */}
      {loading ? (
        <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</div>
      ) : viewMode === 'edit' ? (
        renderEditor()
      ) : viewMode === 'preview' ? (
        renderPreview()
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
            {renderEditor()}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {renderPreview()}
          </div>
        </div>
      )}
    </div>
  );
}
