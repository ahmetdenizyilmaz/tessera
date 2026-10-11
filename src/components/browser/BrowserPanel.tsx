import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Home, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import { browserCommand, browserNeedsFocus, measureBrowserSurface } from '../../lib/browserPanels';
import { usePluginStore } from '../../store/pluginStore';
import { useLayoutStore } from '../../store/layoutStore';
import { MovePanelButton } from '../groups/GroupPanelPicker';
import { PanelShortcutBadge } from '../layout/PanelShortcutBadge';
import './browser.css';
import { usePanelWindow } from '../windows/PanelWindowContext';
import { closePanel } from '../../lib/panelCleanup';

export function BrowserPanel({ instanceId, site }: { instanceId: string; site: 'lichess' }) {
  const panelWindow = usePanelWindow();
  const instance = usePluginStore(s => s.instances.get(instanceId));
  const maximized = useLayoutStore(s => s.maximizedId === instanceId);
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [clickToFocus, setClickToFocus] = useState(false);

  useEffect(() => {
    const view = surface.current?.ownerDocument.defaultView ?? window;
    let disposed = false, frame = 0, busy = false, lastBounds = '', nextStatus = 0;
    setReady(false);
    setError('');
    const tick = async () => {
      if (disposed) return;
      frame = view.requestAnimationFrame(() => void tick());
      if (busy || !surface.current) return;
      setClickToFocus(browserNeedsFocus(surface.current));
      const bounds = measureBrowserSurface(surface.current);
      const key = JSON.stringify(bounds);
      busy = true;
      try {
        if (key !== lastBounds) {
          await browserCommand(instanceId, 'browser_panel_bounds', { bounds, windowLabel: surface.current.ownerDocument.documentElement.dataset.workspaceWindow ?? 'main' });
          lastBounds = key;
        }
        if (Date.now() >= nextStatus) {
          nextStatus = Date.now() + 1500;
          const status = await browserCommand<{ url: string }>(instanceId, 'browser_panel_status');
          if (!disposed) usePluginStore.getState().setBrowserUrl(instanceId, status.url);
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally { busy = false; }
    };
    browserCommand(instanceId, 'browser_panel_create', {
      site, url: usePluginStore.getState().instances.get(instanceId)?.browserUrl ?? null,
    }).then(() => {
      if (disposed) return;
      setReady(true);
      void tick();
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => {
      disposed = true;
      view.cancelAnimationFrame(frame);
      void browserCommand(instanceId, 'browser_panel_bounds', { bounds: null }).catch(() => {});
    };
  }, [instanceId, site, attempt]);

  const action = (action: string) => {
    setError('');
    void browserCommand(instanceId, 'browser_panel_action', { action }).catch(e => setError(String(e)));
  };
  const close = () => {
    void closePanel(instanceId);
  };
  return <div className="browser-panel">
    <div className="terminal-toolbar browser-toolbar">
      <Globe size={15} className="browser-brand" />
      <span className="browser-title">{instance?.title ?? 'Lichess'}<PanelShortcutBadge panelId={instanceId} /></span>
      <button title="Back" aria-label="Back" disabled={!ready} onClick={() => action('back')}><ArrowLeft size={14} /></button>
      <button title="Forward" aria-label="Forward" disabled={!ready} onClick={() => action('forward')}><ArrowRight size={14} /></button>
      <button title="Lichess home" aria-label="Lichess home" disabled={!ready} onClick={() => action('home')}><Home size={14} /></button>
      <button title="Reload Lichess" aria-label="Reload Lichess" disabled={!ready} onClick={() => action('reload')}><RefreshCw size={14} /></button>
      <MovePanelButton panelId={instanceId} />
      <button title={maximized ? 'Restore panel size' : 'Maximize panel'} aria-label={maximized ? 'Restore panel size' : 'Maximize panel'}
        onClick={() => panelWindow.maximize ? panelWindow.maximize() : useLayoutStore.getState().toggleMaximized(instanceId)}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      <button title="Open in default browser" aria-label="Open in default browser" disabled={!ready} onClick={() => action('external')}><ExternalLink size={14} /></button>
      <button title="Close Lichess panel" aria-label="Close Lichess panel" onClick={close}><X size={14} /></button>
    </div>
    {error && <div className="browser-error" role="alert">{error}<button onClick={() => setAttempt(n => n + 1)}>Retry</button></div>}
    <div ref={surface} className="browser-surface" data-browser-surface={instanceId}>
      <div className="browser-placeholder"><Globe size={32} /><strong>Lichess</strong>
        <span>{error ? 'The browser could not be opened.' : clickToFocus ? 'Click to focus and play' : ready ? 'Your chess session stays open while you use Tessera.' : 'Opening Lichess…'}</span>
      </div>
    </div>
  </div>;
}
