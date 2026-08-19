import React, { useState, useRef, useEffect, useCallback } from 'react';

interface MenuBarProps {
  onNewInstance: () => void;
  onQuickInstance: () => void;
  onNewLlmChat: () => void;
  onNewComputer: () => void;
  onResumeSession: () => void;
  onAttachSession?: () => void;
  onSessionHistory: () => void;
  onSaveWorkspace: () => void;
  onLoadWorkspace: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onOfficeView?: () => void;
  onClaudeMd?: () => void;
  onNewNotepad?: () => void;
  onNewTimer?: () => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: false;
  disabled?: boolean;
}

interface MenuSeparator {
  separator: true;
}

type MenuEntry = MenuItem | MenuSeparator;

export const MenuBar: React.FC<MenuBarProps> = ({
  onNewInstance,
  onQuickInstance,
  onNewLlmChat,
  onNewComputer,
  onResumeSession,
  onAttachSession,
  onSessionHistory,
  onSaveWorkspace,
  onLoadWorkspace,
  onSettings,
  onAbout,
  onOfficeView,
  onClaudeMd,
  onNewNotepad,
  onNewTimer,
}) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenMenu(null), []);

  const fileItems: MenuEntry[] = [
    { label: 'New Instance...', shortcut: 'Ctrl+N', action: onNewInstance },
    { label: 'Quick Instance', shortcut: 'Ctrl+Shift+N', action: onQuickInstance },
    { label: 'New LLM Chat', action: onNewLlmChat },
    { label: 'New Computer Panel', action: onNewComputer },
    { separator: true },
    { label: 'Resume Session', action: onResumeSession },
    { label: 'Attach External Session...', action: () => onAttachSession?.() },
    { label: 'Session History', action: onSessionHistory },
    { separator: true },
    { label: 'Save Workspace', shortcut: 'Ctrl+S', action: onSaveWorkspace },
    { label: 'Load Workspace', shortcut: 'Ctrl+O', action: onLoadWorkspace },
    { separator: true },
    { label: 'Import Plugin...', action: () => {}, disabled: true },
    { separator: true },
    { label: 'Settings', shortcut: 'Ctrl+,', action: onSettings },
  ];

  const viewItems: MenuEntry[] = [
    { label: 'Office View', shortcut: 'Ctrl+G', action: () => onOfficeView?.() },
    { separator: true },
    { label: 'CLAUDE.md Editor', shortcut: 'Ctrl+M', action: () => onClaudeMd?.() },
  ];

  const pluginItems: MenuEntry[] = [
    { label: 'Notepad', action: () => onNewNotepad?.() },
    { label: 'Timer', action: () => onNewTimer?.() },
  ];

  const helpItems: MenuEntry[] = [
    { label: 'Keyboard Shortcuts', action: onAbout },
    { label: 'About Claude GUI', action: onAbout },
  ];

  const menus: { label: string; key: string; items: MenuEntry[] }[] = [
    { label: 'File', key: 'file', items: fileItems },
    { label: 'View', key: 'view', items: viewItems },
    { label: 'Plugins', key: 'plugins', items: pluginItems },
    { label: 'Help', key: 'help', items: helpItems },
  ];

  // Close when clicking outside, pressing Escape, or using a keyboard shortcut
  // (e.g. Ctrl+N opens a dialog — the menu should close so it doesn't linger behind it)
  useEffect(() => {
    if (!openMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      // Close on any Ctrl/Meta shortcut so menu doesn't stay behind a dialog
      if (e.ctrlKey || e.metaKey) close();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openMenu, close]);

  // Global keyboard shortcuts are handled in App.tsx

  const handleItemClick = (action: () => void) => {
    close();
    action();
  };

  return (
    <div className="menu-bar" ref={barRef}>
      <span className="menu-bar-logo">{'\u2726'} Claude GUI</span>

      <div className="menu-bar-menus">
        {menus.map((menu) => (
          <div key={menu.key} className="menu-bar-menu">
            <button
              className={`menu-bar-btn ${openMenu === menu.key ? 'menu-bar-btn--open' : ''}`}
              onClick={() => setOpenMenu(openMenu === menu.key ? null : menu.key)}
              onMouseEnter={() => {
                if (openMenu) setOpenMenu(menu.key);
              }}
            >
              {menu.label}
            </button>

            {openMenu === menu.key && (
              <div className="menu-dropdown">
                {menu.items.map((entry, i) =>
                  'separator' in entry && entry.separator ? (
                    <div key={`sep-${i}`} className="menu-dropdown-sep" />
                  ) : (
                    <button
                      key={(entry as MenuItem).label}
                      className="menu-dropdown-item"
                      onClick={() => !(entry as MenuItem).disabled && handleItemClick((entry as MenuItem).action)}
                      style={(entry as MenuItem).disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
                    >
                      <span className="menu-dropdown-label">{(entry as MenuItem).label}</span>
                      {(entry as MenuItem).shortcut && (
                        <span className="menu-dropdown-shortcut">
                          {(entry as MenuItem).shortcut}
                        </span>
                      )}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
