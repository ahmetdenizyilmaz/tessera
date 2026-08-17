import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { useSystemMonitor } from './hooks/useSystemMonitor';
import { useUsagePolling } from './hooks/useUsagePolling';
import { useAutoSave } from './hooks/useAutoSave';
import { useWorkerActivity } from './hooks/useWorkerActivity';
import { useFileDrop } from './hooks/useFileDrop';
import { MenuBar } from './components/menubar/MenuBar';
// Lazy: OfficeView drags in pixi.js (~500KB) — keep it out of the startup chunk
const OfficeView = lazy(() =>
  import('./components/office/OfficeView').then((m) => ({ default: m.OfficeView })),
);
import { TabBar } from './components/tabs/TabBar';
import { MosaicLayout } from './components/layout/MosaicLayout';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/statusbar/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SplashScreen } from './components/SplashScreen';
import { NewInstanceDialog } from './components/dialogs/NewInstanceDialog';
import { ResumeSessionDialog } from './components/dialogs/ResumeSessionDialog';
import { AttachSessionDialog } from './components/dialogs/AttachSessionDialog';
import { SaveLoadDialog } from './components/dialogs/SaveLoadDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { AboutDialog } from './components/menubar/AboutDialog';
import { UsageModal } from './components/dialogs/UsageModal';
import { NewLlmDialog } from './components/dialogs/NewLlmDialog';
import { SessionHistoryDialog } from './components/dialogs/SessionHistoryDialog';
import { ClaudeMdDialog } from './components/dialogs/ClaudeMdDialog';
import { useInstanceStore } from './store/instanceStore';
import { useLayoutStore, canAddPanel, notifyPanelLimit } from './store/layoutStore';
import { Toasts } from './lib/toast';
import { useGroupStore } from './store/groupStore';
import { usePluginStore } from './store/pluginStore';
import { useSettingsStore } from './store/settingsStore';
import { registerBuiltins } from './lib/builtinPlugins';
import type { LlmProvider } from './types/instance';

// Register built-in plugins at module load (before any render)
registerBuiltins();

export default function App() {
  useSystemMonitor();
  useUsagePolling();
  useAutoSave();
  useWorkerActivity();

  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splash-shown'));
  // Stable identity — an inline closure would reset SplashScreen's timers on every App render
  const hideSplash = useCallback(() => setShowSplash(false), []);
  const [viewMode, setViewMode] = useState<'panels' | 'office'>('panels');
  const [showNewInstance, setShowNewInstance] = useState(false);
  const [showResumeSession, setShowResumeSession] = useState(false);
  const [showSaveLoad, setShowSaveLoad] = useState<'save' | 'load' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [showNewLlm, setShowNewLlm] = useState<Exclude<LlmProvider, 'claude'> | null>(null);
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [showClaudeMd, setShowClaudeMd] = useState(false);
  // Attach-session dialog; droppedFolder is set when opened by a folder drop
  const [attachSession, setAttachSession] = useState<{ open: boolean; cwd: string | null }>(
    { open: false, cwd: null },
  );

  const handleFolderDropped = useCallback((path: string) => {
    setAttachSession({ open: true, cwd: path });
  }, []);
  useFileDrop(handleFolderDropped);

  const handleNewInstance = useCallback(async (panelView: 'chat' | 'terminal' = 'chat') => {
    // Refuse BEFORE addInstance — refusing only at addPanel leaves an
    // invisible instance behind in the store.
    if (!canAddPanel()) { notifyPanelLimit(); return; }
    const settings = useSettingsStore.getState().settings;
    // Real path, not '.' — encode_project_path('.') breaks session-file
    // resolution and usage polling on the Rust side
    // Prefer the folder of the last created instance: home is where every
    // ad-hoc CLI session lands, and quick-created panels defaulting there is
    // what kept tangling them with foreign conversations.
    const cwd = settings.lastCwd || (await homeDir().catch(() => ''));
    // Picking chat or terminal here counts as choosing a type, so the New
    // Instance dialog opens on it next time.
    useSettingsStore.getState().updateSettings({ lastPanelView: panelView });
    const id = useInstanceStore.getState().addInstance({
      cwd,
      panelView,
      model: settings.lastModel || settings.defaultModel,
      dangerouslySkipPermissions: settings.defaultSkipPermissions,
      permissionMode: settings.defaultPermissionMode,
      allowedTools: [],
      maxBudget: 0,
      systemPrompt: '',
      agentMode: settings.defaultAgentMode,
    });
    useLayoutStore.getState().addPanel(id);
    // Also register in group if we're inside one
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    if (currentGroupId) {
      useGroupStore.getState().addToGroup(currentGroupId, id);
    }
  }, []);

  const handleNewGroup = useCallback(() => {
    if (!canAddPanel()) { notifyPanelLimit(); return; }
    // Determine current group context (null = root)
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    // Create the group in groupStore
    const groupId = useGroupStore.getState().createGroup(currentGroupId);
    // Add as a panel in layoutStore so it appears in the mosaic
    useLayoutStore.getState().addPanel(groupId, 'group');
  }, []);

  const handleNewPlugin = useCallback((pluginName: string) => {
    if (!canAddPanel()) { notifyPanelLimit(); return; }
    const instanceId = usePluginStore.getState().createInstance(pluginName);
    if (instanceId) {
      useLayoutStore.getState().addPanel(instanceId, 'plugin');
      const currentGroupId = useGroupStore.getState().getCurrentGroupId();
      if (currentGroupId) {
        useGroupStore.getState().addToGroup(currentGroupId, instanceId);
      }
    }
  }, []);

  // Scan for external plugins on app init (built-ins registered at module load)
  useEffect(() => {
    usePluginStore.getState().scanPlugins();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes any open dialog
      if (e.key === 'Escape') {
        if (showNewInstance) { setShowNewInstance(false); return; }
        if (showSettings) { setShowSettings(false); return; }
        if (showSaveLoad) { setShowSaveLoad(null); return; }
        if (showClaudeMd) { setShowClaudeMd(false); return; }
        if (showAbout) { setShowAbout(false); return; }
        if (showResumeSession) { setShowResumeSession(false); return; }
        if (showSessionHistory) { setShowSessionHistory(false); return; }
        if (showNewLlm) { setShowNewLlm(null); return; }
        // No dialog open: Escape leaves a maximized panel and brings the
        // mosaic back.
        if (useLayoutStore.getState().maximizedId) {
          useLayoutStore.getState().toggleMaximized(useLayoutStore.getState().maximizedId!);
        }
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      // Ctrl+Tab / Ctrl+Shift+Tab cycle panels. Handled before the switch
      // because preventDefault has to beat the webview's own focus traversal.
      if (e.key === 'Tab') {
        e.preventDefault();
        useLayoutStore.getState().cycleFocus(e.shiftKey ? -1 : 1);
        // Clicking a panel moves DOM focus as a side effect; a keyboard switch
        // has to do it explicitly, or the next keystroke still lands in the
        // panel we just left. One frame later, so the layout has re-rendered.
        const target = useLayoutStore.getState().focusedId;
        if (target) {
          requestAnimationFrame(() => {
            // Matches the chat composer and xterm's helper textarea alike.
            document
              .querySelector<HTMLTextAreaElement>(`[data-panel-id="${CSS.escape(target)}"] textarea`)
              ?.focus();
          });
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          if (e.shiftKey) {
            // Ctrl+Shift+N → quick create with default settings
            handleNewInstance();
          } else {
            // Ctrl+N → open New Instance dialog
            setShowNewInstance(true);
          }
          break;
        case 's':
          e.preventDefault();
          setShowSaveLoad('save');
          break;
        case 'o':
          e.preventDefault();
          setShowSaveLoad('load');
          break;
        case ',':
          e.preventDefault();
          setShowSettings(true);
          break;
        case 'g':
          e.preventDefault();
          setViewMode(v => v === 'panels' ? 'office' : 'panels');
          break;
        case 'm':
          e.preventDefault();
          setShowClaudeMd(true);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNewInstance, showNewInstance, showSettings, showSaveLoad, showClaudeMd, showAbout, showResumeSession, showSessionHistory, showNewLlm]);

  return (
    <ErrorBoundary>
      {showSplash && <SplashScreen onComplete={hideSplash} />}
      <div className="app" style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <MenuBar
          onNewInstance={() => setShowNewInstance(true)}
          onQuickInstance={handleNewInstance}
          onNewLlmChat={() => setShowNewLlm('openai')}
          onNewComputer={() => {
            if (!canAddPanel()) { notifyPanelLimit(); return; }
            const id = useInstanceStore.getState().addInstance({
              cwd: '.',
              model: '',
              dangerouslySkipPermissions: false,
              permissionMode: 'default',
              allowedTools: [],
              maxBudget: 0,
              systemPrompt: '',
              agentMode: false,
            }, 'Computer');
            useLayoutStore.getState().addPanel(id, 'computer');
          }}
          onResumeSession={() => setShowResumeSession(true)}
          onAttachSession={() => setAttachSession({ open: true, cwd: null })}
          onSessionHistory={() => setShowSessionHistory(true)}
          onSaveWorkspace={() => setShowSaveLoad('save')}
          onLoadWorkspace={() => setShowSaveLoad('load')}
          onSettings={() => setShowSettings(true)}
          onAbout={() => setShowAbout(true)}
          onOfficeView={() => setViewMode(v => v === 'panels' ? 'office' : 'panels')}
          onClaudeMd={() => setShowClaudeMd(true)}
          onNewNotepad={() => handleNewPlugin('notepad')}
          onNewTimer={() => handleNewPlugin('timer')}
          onNewMessenger={() => handleNewPlugin('messenger')}
          onNewDevStudio={() => handleNewPlugin('devstudio')}
        />

        {viewMode === 'panels' ? (
          <>
            <TabBar onNewInstance={(v) => handleNewInstance(v)} onNewInstanceSettings={() => setShowNewInstance(true)} onNewLlmChat={(p) => setShowNewLlm(p ?? 'openai')} onNewGroup={handleNewGroup} onNewPlugin={handleNewPlugin} />
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <Sidebar />
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <MosaicLayout />
              </div>
            </div>
          </>
        ) : (
          <Suspense fallback={null}>
            <OfficeView onBack={() => setViewMode('panels')} />
          </Suspense>
        )}

        <StatusBar
          onNewInstance={handleNewInstance}
          onUsageClick={() => setShowUsage(true)}
        />

        {/* Mount conditionally so useState initializers run fresh on every open
            (stale name/cwd otherwise persist for the app's lifetime) */}
        {showNewInstance && (
          <NewInstanceDialog
            isOpen={true}
            onClose={() => setShowNewInstance(false)}
          />
        )}
        {showResumeSession && (
          <ResumeSessionDialog
            isOpen={true}
            onClose={() => setShowResumeSession(false)}
          />
        )}
        {attachSession.open && (
          <AttachSessionDialog
            isOpen={true}
            initialCwd={attachSession.cwd}
            onClose={() => setAttachSession({ open: false, cwd: null })}
          />
        )}
        {showSaveLoad && (
          <SaveLoadDialog
            isOpen={true}
            onClose={() => setShowSaveLoad(null)}
            mode={showSaveLoad}
          />
        )}
        <SettingsDialog
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
        <AboutDialog
          isOpen={showAbout}
          onClose={() => setShowAbout(false)}
        />
        <UsageModal
          isOpen={showUsage}
          onClose={() => setShowUsage(false)}
        />
        <NewLlmDialog
          isOpen={showNewLlm !== null}
          initialProvider={showNewLlm ?? undefined}
          onClose={() => setShowNewLlm(null)}
        />
        <SessionHistoryDialog
          isOpen={showSessionHistory}
          onClose={() => setShowSessionHistory(false)}
        />
        <ClaudeMdDialog
          isOpen={showClaudeMd}
          onClose={() => setShowClaudeMd(false)}
        />
        <Toasts />
      </div>
    </ErrorBoundary>
  );
}
