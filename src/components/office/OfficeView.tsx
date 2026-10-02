import { useRef, useEffect, useState, useCallback } from 'react';
import { Minus, Plus, Scan, Users } from 'lucide-react';
import { IsometricEngine } from '../../engine/IsometricEngine';
import { WorkerAnimator } from '../../engine/WorkerAnimator';
import { getProviderColor } from '../../engine/SpriteManager';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { useInstanceStore } from '../../store/instanceStore';
import { officeProvider, PROVIDER_NAMES } from '../../lib/officeActivity';
import { focusShortcutPanel } from '../../lib/panelShortcuts';
import { OfficeHUD } from './OfficeHUD';
import { OfficeShop } from './OfficeShop';
import { OfficeTeam } from './OfficeTeam';
import { OfficeChat } from './OfficeChat';
import { EditModeOverlay } from './EditModeOverlay';
import '../../styles/office.css';

export function OfficeView({ onBack }: { onBack: () => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<IsometricEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const layout = useOfficeGameStore(s => s.layout);
  const editMode = useOfficeGameStore(s => s.editMode);
  const shopOpen = useOfficeGameStore(s => s.shopOpen);
  const count = useOfficeGameStore(s => Object.keys(s.workers).length);
  const selectedInstance = useInstanceStore(s => selected ? s.instances.get(selected) : undefined);
  const selectAgent = useCallback((id: string | null) => {
    setHover(null); setSelected(current => current === id ? null : id);
  }, []);
  const closeChat = useCallback(() => { setSelected(null); setHover(null); }, []);
  const openPanel = useCallback((id: string) => { focusShortcutPanel(id); onBack(); }, [onBack]);

  useEffect(() => {
    if (!canvasRef.current) return;
    let disposed = false, frameId = 0;
    const engine = new IsometricEngine(), animator = new WorkerAnimator();
    engineRef.current = engine;
    engine.onWorkerClick(selectAgent);
    engine.onBackgroundClick(closeChat);
    engine.onWorkerHover(id => setHover(id));
    engine.onTileClick((gridX, gridY) => useOfficeGameStore.getState().placeAt({ gridX, gridY }));
    void engine.init(canvasRef.current).then(() => {
      if (disposed) return;
      const initial = useOfficeGameStore.getState();
      engine.drawFloor(initial.layout); engine.drawWalls(initial.layout); engine.drawFurniture(initial.layout.furniture);
      engine.showGrid(initial.layout, initial.editMode); engine.centerCamera(); setReady(true);
      let lastTime = performance.now();
      let lastLayout = initial.layout;
      const targets = new Map<string, string>();
      const loop = (time: number) => {
        if (disposed) return;
        const dt = Math.min((time - lastTime) / 1000, .1); lastTime = time;
        const state = useOfficeGameStore.getState(), ids = Object.keys(state.workers);
        engine.syncWorkers(ids);
        for (const id of targets.keys()) if (!state.workers[id]) { targets.delete(id); animator.removeWorker(id); }
        for (const [id, worker] of Object.entries(state.workers)) {
          const key = `${worker.targetPosition.gridX},${worker.targetPosition.gridY}`;
          if (targets.get(id) !== key || lastLayout !== state.layout) { targets.set(id, key); animator.assignPath(id, worker, state.layout); }
        }
        lastLayout = state.layout;
        const poses = animator.update(dt, state.workers);
        engine.updateWorkerPositions(poses);
        for (const [id, worker] of Object.entries(state.workers)) {
          const instance = useInstanceStore.getState().instances.get(id); if (!instance) continue;
          const provider = officeProvider(instance);
          engine.updateWorkerGraphic(id, getProviderColor(provider), worker.activity, instance.name, PROVIDER_NAMES[provider] ?? provider,
            state.profiles[id]?.accessory, poses.get(id)?.isWalking, Math.floor(time / 180), state.profiles[id]?.appearanceId);
        }
        // Commit only after arrival; moving characters stay local to the renderer.
        const settled = new Map([...poses].filter(([id, p]) => !p.isWalking && (state.workers[id].position.x !== p.x || state.workers[id].position.y !== p.y)));
        if (settled.size) state.settleWorkers(settled);
        frameId = requestAnimationFrame(loop);
      };
      frameId = requestAnimationFrame(loop);
    }).catch(e => { if (!disposed) setError(`The office renderer could not start: ${String(e)}`); });
    return () => { disposed = true; cancelAnimationFrame(frameId); engine.destroy(); engineRef.current = null; };
  }, [selectAgent, closeChat]);
  useEffect(() => {
    if (!ready) return;
    const engine = engineRef.current!;
    engine.drawFloor(layout); engine.drawWalls(layout); engine.drawFurniture(layout.furniture); engine.showGrid(layout, editMode);
  }, [layout, editMode, ready]);
  useEffect(() => { if (shopOpen || editMode || !selectedInstance) closeChat(); }, [shopOpen, editMode, selectedInstance?.id, closeChat]);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { const s = useOfficeGameStore.getState(); s.setShopOpen(false); s.setEditMode(false); closeChat(); }
      if (e.key.toLowerCase() === 'r' && useOfficeGameStore.getState().editMode && !(e.target instanceof HTMLInputElement)) useOfficeGameStore.setState(s => ({ rotation: ((s.rotation + 1) % 4) as 0 | 1 | 2 | 3 }));
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [closeChat]);
  return <div className={`office-view${selectedInstance ? ' office-view--chat' : ''}`}>
    <OfficeHUD onBack={onBack} />
    <div className="office-stage">
      <div ref={canvasRef} className="office-canvas" aria-label="Animated agent office" />
      {!ready && !error && <div className="office-loading">Opening your office…</div>}
      {error && <div className="office-loading" role="alert">{error}</div>}
      {ready && !count && <div className="office-empty"><Users size={25} /><h3>Your team starts here</h3><p>Open an agent panel and its character will join the office.</p><button onClick={onBack}>Go to panels</button></div>}
      <div className="office-camera"><button aria-label="Zoom out" onClick={() => engineRef.current?.zoomBy(-.15)}><Minus size={16} /></button><button aria-label="Fit office" onClick={() => engineRef.current?.centerCamera()}><Scan size={16} /></button><button aria-label="Zoom in" onClick={() => engineRef.current?.zoomBy(.15)}><Plus size={16} /></button></div>
      <div className="office-map-caption"><span className="office-live-dot" /> LIVE OFFICE <span>{editMode ? 'Click a tile to decorate · R to rotate · Shift + drag to pan' : 'Drag to explore · Scroll to zoom · Select an agent'}</span></div>
    </div>
    <OfficeTeam selected={selected ?? hover} onSelect={selectAgent} onOpen={openPanel} collapsed={!!selectedInstance} onExpand={closeChat} />
    {selectedInstance && <OfficeChat key={`${selectedInstance.id}:${selectedInstance.claudeSessionId ?? selectedInstance.codexThreadId ?? selectedInstance.opencodeSessionId ?? selectedInstance.antigravityConversationId ?? ''}`} instance={selectedInstance} onClose={closeChat} onOpen={openPanel} />}
    {shopOpen && <OfficeShop />}
    {editMode && <EditModeOverlay />}
  </div>;
}
