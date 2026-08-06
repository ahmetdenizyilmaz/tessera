import React, { useEffect } from 'react';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS: { key: string; label: string }[] = [
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
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h2>About Claude GUI</h2>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            Claude GUI
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
            Version 0.0.2-beta
          </div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 14 }}>
            A native desktop application for running multiple Claude Code CLI
            instances in a tiled, split-screen layout with a dual chat and
            terminal interface.
          </p>
        </div>

        <div className="about-shortcuts">
          <div className="about-shortcuts-title">Keyboard Shortcuts</div>
          <div className="about-shortcuts-grid">
            {SHORTCUTS.map((s) => (
              <React.Fragment key={s.key}>
                <span className="about-shortcut-key">{s.key}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="dialog-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
