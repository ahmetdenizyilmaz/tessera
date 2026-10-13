import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { usePanelLockStore } from '../../store/panelLockStore';

export function PanelLockButton({ panelId }: { panelId: string }) {
  const locked = usePanelLockStore(s => s.lockedIds.has(panelId));
  return <button type="button" className={`toolbar-btn panel-lock-button${locked ? ' is-locked' : ''}`}
    aria-label={locked ? 'Unlock panel position' : 'Lock panel position'} aria-pressed={locked}
    title={locked ? 'Position locked — stays in its small slot until focused. The main panel can still swap.' : 'Lock position when other panels are focused'}
    onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onClick={e => { e.stopPropagation(); usePanelLockStore.getState().setLocked(panelId, !locked); }}>
    {locked ? <LockKeyhole size={14} /> : <LockKeyholeOpen size={14} />}
  </button>;
}
