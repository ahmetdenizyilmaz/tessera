import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Home, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import { PluginIcon } from '../icons/PluginIcon';
import { browserCommand, browserNeedsFocus, measureBrowserSurface } from '../../lib/browserPanels';
import { usePluginStore } from '../../store/pluginStore';
import { MovePanelButton } from '../groups/GroupPanelPicker';
import { PanelShortcutBadge } from '../layout/PanelShortcutBadge';
import './browser.css';
import { usePanelLayout } from '../windows/PanelWindowContext';
import { closePanel } from '../../lib/panelCleanup';
import { listen } from '@tauri-apps/api/event';
import { PANEL_MAXIMIZE_EVENT } from '../../lib/panelMaximize';
import { BrowserViewSettings } from './BrowserViewSettings';
import { useBrowserViewStore } from '../../store/browserViewStore';
import { PanelLockButton } from '../layout/PanelLockButton';
import { migrateLegacyNotes } from '../../lib/htmlPlugins';
import { NOTES_APP } from '../../lib/bundledApps';
import { AddonManager } from '../plugins/AddonManager';
import { useBackgroundImage, usePanelBackground } from '../appearance/PanelAppearance';
import { backgroundForeground } from '../../lib/panelBackground';

export function BrowserPanel({ instanceId, site }: { instanceId: string; site: string }) {
  const useLayoutStore = usePanelLayout();
  const instance = usePluginStore(s => s.instances.get(instanceId));
  const htmlPlugin = usePluginStore(s => !!s.registry.get(instance?.pluginName ?? '')?.htmlPlugin);
  const homeUrl=usePluginStore(s=>s.registry.get(instance?.pluginName??'')?.homeUrl);
  const appTitle=usePluginStore(s=>s.registry.get(instance?.pluginName??'')?.defaultTitle) ?? 'Web app';
  const title=instance?.title??'Web app';
  const maximized = useLayoutStore(s => s.maximizedId === instanceId);
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [clickToFocus, setClickToFocus] = useState(false);
  const [permissions, setPermissions] = useState(false);
  const shownError = error || syncError;
  const background = usePanelBackground(instanceId), backgroundImage = useBackgroundImage(background);

  useEffect(() => {
    if (!htmlPlugin || !ready) return;
    void browserCommand(instanceId, 'browser_panel_appearance', { appearance: {
      enabled: background.mode !== 'theme', color: background.color, foreground: backgroundForeground(background),
      image: background.mode === 'image' ? backgroundImage?.image ?? null : null, fit: background.fit, dim: background.dim,
    }}).catch(e => console.warn('Could not update app background:', e));
  }, [instanceId, htmlPlugin, ready, background, backgroundImage?.image]);

  useEffect(() => {
    let disposed = false;
    const listener = listen<string>('browser-panel-maximize', event => {
      if (disposed || event.payload !== instanceId) return;
      surface.current?.ownerDocument.defaultView?.dispatchEvent(new CustomEvent(PANEL_MAXIMIZE_EVENT, { detail: instanceId }));
    });
    return () => { disposed = true; void listener.then(unlisten => unlisten()); };
  }, [instanceId]);

  useEffect(() => {
    if (!htmlPlugin) return;
    const unlisten = listen<{ id: string; title?: string; badge?: number | null; openPermissions?: boolean }>('html-plugin-ui', ({ payload }) => {
      if (payload.id !== instanceId) return;
      if (payload.title !== undefined) usePluginStore.getState().setInstanceTitle(instanceId, payload.title);
      if (payload.badge !== undefined) usePluginStore.getState().setInstanceBadge(instanceId, payload.badge);
      if (payload.openPermissions) setPermissions(true);
    });
    return () => { void unlisten.then(fn => fn()); };
  }, [instanceId, htmlPlugin]);

  useEffect(() => {
    const view = surface.current?.ownerDocument.defaultView ?? window;
    let disposed = false, frame = 0, busy = false, lastBounds = '', nextStatus = 0;
    setReady(false);
    setError('');
    setSyncError('');
    const tick = async () => {
      if (disposed) return;
      frame = view.requestAnimationFrame(() => void tick());
      if (busy || !surface.current) return;
      const preference = useBrowserViewStore.getState().preferences[site];
      setClickToFocus(browserNeedsFocus(surface.current, preference));
      const bounds = measureBrowserSurface(surface.current, preference);
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
          if (!disposed) {
            if (!htmlPlugin) usePluginStore.getState().setBrowserUrl(instanceId, status.url);
            setSyncError('');
          }
        }
      } catch (e) {
        if (!disposed) setSyncError(String(e));
      } finally { busy = false; }
    };
    (site === NOTES_APP ? migrateLegacyNotes() : Promise.resolve()).then(() => {
      if (disposed) return;
      return browserCommand(instanceId, 'browser_panel_create', {
      site, homeUrl:homeUrl??null, url: usePluginStore.getState().instances.get(instanceId)?.browserUrl ?? null,
      });
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
  }, [instanceId, site, homeUrl, attempt, htmlPlugin]);

  const action = (action: string) => {
    setError('');
    void browserCommand(instanceId, 'browser_panel_action', { action }).catch(e => setError(String(e)));
  };
  const close = () => {
    void closePanel(instanceId);
  };
  return <div className="browser-panel">
    {permissions && <AddonManager initialPermissions={instance?.pluginName ?? site} onClose={() => setPermissions(false)} />}
    <div className="terminal-toolbar browser-toolbar">
      <PluginIcon icon={instance?.icon??'Globe'} size={15} className="browser-brand" />
      <span className="browser-title">{title}<PanelShortcutBadge panelId={instanceId} /></span>
      <BrowserViewSettings panelId={instanceId} site={site} pluginName={instance?.pluginName ?? site} title={appTitle} surface={surface} />
      <PanelLockButton panelId={instanceId} />
      {!htmlPlugin && <><button className="browser-navigation" title="Back" aria-label="Back" disabled={!ready} onClick={() => action('back')}><ArrowLeft size={14} /></button>
      <button className="browser-navigation" title="Forward" aria-label="Forward" disabled={!ready} onClick={() => action('forward')}><ArrowRight size={14} /></button>
      <button className="browser-navigation" title={`${title} home`} aria-label={`${title} home`} disabled={!ready} onClick={() => action('home')}><Home size={14} /></button></>}
      <button title={`Reload ${title}`} aria-label={`Reload ${title}`} disabled={!ready} onClick={() => action('reload')}><RefreshCw size={14} /></button>
      <MovePanelButton panelId={instanceId} />
      <button title={maximized ? 'Restore panel size' : 'Maximize panel'} aria-label={maximized ? 'Restore panel size' : 'Maximize panel'}
        onClick={() => useLayoutStore.getState().toggleMaximized(instanceId)}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      {!htmlPlugin && <button title="Open in default browser" aria-label="Open in default browser" disabled={!ready} onClick={() => action('external')}><ExternalLink size={14} /></button>}
      <button title={`Close ${title} panel`} aria-label={`Close ${title} panel`} onClick={close}><X size={14} /></button>
    </div>
    {shownError && <div className="browser-error" role="alert">{shownError}<button onClick={() => setAttempt(n => n + 1)}>Retry</button></div>}
    <div ref={surface} className="browser-surface" data-browser-surface={instanceId}>
      <div className="browser-placeholder"><PluginIcon icon={instance?.icon??'Globe'} size={32} /><strong>{title}</strong>
        <span>{shownError ? 'The browser could not be opened.' : clickToFocus ? 'Click to focus and interact' : ready ? 'Your session stays open while you use Tessera.' : `Opening ${title}…`}</span>
      </div>
    </div>
  </div>;
}
