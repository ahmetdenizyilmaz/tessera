import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthGate } from './auth/AuthGate';
import App from './App';
import { initStreamBridge } from './lib/streamBridge';
import { initThemeManager } from './lib/themeManager';
import './styles/global.css';
import './styles/themes.css';
import './styles/terminal.css';
import './styles/chat.css';
import './styles/mosaic.css';

// Register global callbacks for Rust → JS stream data delivery
initStreamBridge();
initThemeManager();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
);
