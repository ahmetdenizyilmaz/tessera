import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Moon, Play } from 'lucide-react';
import { useInstanceStore } from '../../store/instanceStore';
import { usePanelHibernationStore, type PanelPreview } from '../../store/panelHibernationStore';
import { wakePanel } from '../../lib/panelHibernation';
import { closePanel } from '../../lib/panelCleanup';
import { AgentPanelHeader } from './AgentPanelHeader';
import './hibernation.css';

export function HibernatedPanel({ instanceId, onClose }: { instanceId: string; onClose?: () => void }) {
  const instance = useInstanceStore(s => s.instances.get(instanceId));
  const preview = usePanelHibernationStore(s => s.previews[instanceId]);
  const phase = usePanelHibernationStore(s => s.phases[instanceId]);
  const error = usePanelHibernationStore(s => s.errors[instanceId]);
  const [previewError, setPreviewError] = useState('');
  const previewId = instance?.hibernation?.previewId;
  useEffect(() => {
    if (preview || !previewId) return;
    let cancelled = false;
    void invoke<PanelPreview>('panel_preview_read', { previewId }).then(value => {
      if (!cancelled) usePanelHibernationStore.setState(s => ({ previews: { ...s.previews, [instanceId]: value } }));
    }).catch(() => { if (!cancelled) setPreviewError('Preview unavailable. Your saved conversation can still be resumed.'); });
    return () => { cancelled = true; };
  }, [instanceId, previewId, preview]);
  if (!instance) return null;
  return <div className="terminal-panel hibernated-panel" style={{ borderTop: `2px solid ${instance.color}` }}>
    <AgentPanelHeader instanceId={instanceId} status="Hibernating" statusColor="var(--text-secondary)"
      metadata={`${instance.config.agentProvider ?? 'Claude'} · ${instance.config.model}`}
      onClose={onClose ?? (() => { void closePanel(instanceId); })} />
    <div className="hibernated-body">
      <pre className={`hibernated-preview ${preview?.terminal ? '' : 'hibernated-chat-preview'}`} aria-label="Last panel content"
        style={{ fontSize: preview?.fontSize, fontFamily: preview?.fontFamily }}>
        {preview?.text || previewError || 'Your conversation is saved.'}
      </pre>
      <div className="hibernated-shade">
        <div className="hibernated-card">
          <span className="hibernated-heading"><Moon size={16} aria-hidden="true" /> Panel hibernating</span>
          <span className="hibernated-description">Agent and MCP processes released.</span>
          <button type="button" className="hibernated-wake" disabled={!!phase}
            onClick={() => { void wakePanel(instanceId).catch(() => {}); }}>
            <Play size={14} aria-hidden="true" />{phase === 'waking' ? 'Waking…' : 'Wake panel'}
          </button>
          {error && <span role="alert" className="hibernation-error">{error}</span>}
        </div>
      </div>
    </div>
  </div>;
}
