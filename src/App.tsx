import { useState, useCallback, useEffect } from 'react';
import { useSystemMonitor } from './hooks/useSystemMonitor';
import { useUsagePolling } from './hooks/useUsagePolling';
import { useAutoSave } from './hooks/useAutoSave';
import { useWorkerActivity } from './hooks/useWorkerActivity';
import { MenuBar } from './components/menubar/MenuBar';
import { OfficeView } from './components/office/OfficeView';
import { TabBar } from './components/tabs/TabBar';
import { MosaicLayout } from './components/layout/MosaicLayout';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/statusbar/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SplashScreen } from './components/SplashScreen';
import { NewInstanceDialog } from './components/dialogs/NewInstanceDialog';
import { ResumeSessionDialog } from './components/dialogs/ResumeSessionDialog';
import { SaveLoadDialog } from './components/dialogs/SaveLoadDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { AboutDialog } from './components/menubar/AboutDialog';
import { UsageModal } from './components/dialogs/UsageModal';
import { NewLlmDialog } from './components/dialogs/NewLlmDialog';
import { SessionHistoryDialog } from './components/dialogs/SessionHistoryDialog';
import { ClaudeMdDialog } from './components/dialogs/ClaudeMdDialog';
import { useInstanceStore } from './store/instanceStore';
import { useLayoutStore } from './store/layoutStore';
import { useGroupStore } from './store/groupStore';
import { usePluginStore } from './store/pluginStore';
import { useSettingsStore } from './store/settingsStore';
import { useChatStore } from './store/chatStore';
import { registerBuiltins } from './lib/builtinPlugins';
import type { LlmProvider } from './types/instance';
import type { ChatMessage, AccumulatedUserMessage, AccumulatedMessage } from './types/stream';

// DEV: Inject test messages for visual/overlap testing (Ctrl+T)
function injectTestMessages() {
  const layout = useLayoutStore.getState();
  const activeTab = layout.activeTabId;
  if (!activeTab) { alert('No active tab'); return; }
  const chatStore = useChatStore.getState();
  let session = chatStore.sessions.get(activeTab);
  if (!session) {
    chatStore.initSession(activeTab);
    session = chatStore.sessions.get(activeTab)!;
  }

  const msgs: ChatMessage[] = [];
  const count = 600; // Over 500 to trigger virtualizer

  for (let i = 0; i < count; i++) {
    const uid = `test-user-${i}`;
    const aid = `test-asst-${i}`;

    // User message
    const userMsg: AccumulatedUserMessage = {
      id: uid, role: 'user', text: `Test message #${i + 1}: ${'Lorem ipsum dolor sit amet. '.repeat(1 + (i % 5))}`, timestamp: Date.now() - (count - i) * 1000,
    };
    msgs.push(userMsg);

    // Assistant message with varied content
    const blocks: AccumulatedMessage['blocks'] = [];
    if (i % 7 === 0) {
      // Thinking block
      blocks.push({ type: 'thinking', thinking: `Analyzing request #${i + 1}...` });
    }
    // Text block with varied length
    const textLen = i % 10 === 0 ? 8 : i % 5 === 0 ? 4 : 1;
    blocks.push({
      type: 'text',
      text: `**Response ${i + 1}**\n\n${'This is a paragraph of test content to verify that long messages render correctly without overlapping. '.repeat(textLen)}${i % 3 === 0 ? '\n\n```typescript\nconst x = ' + i + ';\nconsole.log("test line 1");\nconsole.log("test line 2");\nconsole.log("test line 3");\n```' : ''}`,
    });
    // Tool use block every 4th message
    if (i % 4 === 0) {
      blocks.push({ type: 'tool_use', id: `tool-${i}`, name: i % 8 === 0 ? 'Bash' : 'Read', input: { command: `echo "test ${i}"` }, result: `Output line 1\nOutput line 2\nDone.` });
    }

    const asstMsg: AccumulatedMessage = {
      id: aid, role: 'assistant', blocks, isStreaming: false,
    };
    msgs.push(asstMsg);
  }

  // Directly set messages in the session
  useChatStore.setState((state) => {
    const newSessions = new Map(state.sessions);
    const s = newSessions.get(activeTab);
    if (s) {
      s.messages = msgs;
    }
    return { sessions: newSessions };
  });
  console.log(`Injected ${msgs.length} test messages (${count} pairs) into ${activeTab}`);
}

// Register built-in plugins at module load (before any render)
registerBuiltins();

export default function App() {
  useSystemMonitor();
  useUsagePolling();
  useAutoSave();
  useWorkerActivity();

  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splash-shown'));
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

  const handleNewInstance = useCallback(() => {
    const settings = useSettingsStore.getState().settings;
    const id = useInstanceStore.getState().addInstance({
      cwd: '.',
      model: settings.defaultModel,
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
    // Determine current group context (null = root)
    const currentGroupId = useGroupStore.getState().getCurrentGroupId();
    // Create the group in groupStore
    const groupId = useGroupStore.getState().createGroup(currentGroupId);
    // Add as a panel in layoutStore so it appears in the mosaic
    useLayoutStore.getState().addPanel(groupId, 'group');
  }, []);

  const handleNewPlugin = useCallback((pluginName: string) => {
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
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

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
        // case 'j': e.preventDefault(); injectTestMessages(); break; // DEV: uncomment to test
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNewInstance, showNewInstance, showSettings, showSaveLoad, showClaudeMd, showAbout, showResumeSession, showSessionHistory, showNewLlm]);

  return (
    <ErrorBoundary>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <div className="app" style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <MenuBar
          onNewInstance={() => setShowNewInstance(true)}
          onQuickInstance={handleNewInstance}
          onNewLlmChat={() => setShowNewLlm('openai')}
          onNewComputer={() => {
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
            <TabBar onNewInstance={handleNewInstance} onNewInstanceSettings={() => setShowNewInstance(true)} onNewLlmChat={(p) => setShowNewLlm(p ?? 'openai')} onNewGroup={handleNewGroup} onNewPlugin={handleNewPlugin} />
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <Sidebar />
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <MosaicLayout />
              </div>
            </div>
          </>
        ) : (
          <OfficeView onBack={() => setViewMode('panels')} />
        )}

        <StatusBar
          onNewInstance={handleNewInstance}
          onUsageClick={() => setShowUsage(true)}
        />

        <NewInstanceDialog
          isOpen={showNewInstance}
          onClose={() => setShowNewInstance(false)}
        />
        <ResumeSessionDialog
          isOpen={showResumeSession}
          onClose={() => setShowResumeSession(false)}
        />
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
      </div>
    </ErrorBoundary>
  );
}
