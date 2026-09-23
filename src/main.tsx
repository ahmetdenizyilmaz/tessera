import './styles/codex.css';
import './styles/opencode.css';
import { initCodexBridge } from './lib/codexBridge';
import { initOpenCodeBridge } from './lib/opencodeBridge';
import './lib/brandMigration'; // must run before any store hydrates
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './auth/AuthGate';
import App from './App';
import { initStreamBridge } from './lib/streamBridge';
import { initPanelBus } from './lib/panelBus';
import { initLaunchBridge } from './lib/launchBridge';
import { initThemeManager } from './lib/themeManager';
import { initLanBridge } from './store/lanStore';
import { initTerminalSharing } from './lib/terminalSharing';
import './styles/global.css';
import './styles/themes.css';
import './styles/terminal.css';
import './styles/chat.css';
import './styles/mosaic.css';

// Register global callbacks for Rust → JS stream data delivery
initStreamBridge();
initPanelBus();
void initCodexBridge();
initOpenCodeBridge();
initLaunchBridge();
initThemeManager();
void initLanBridge();
void initTerminalSharing();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
);
