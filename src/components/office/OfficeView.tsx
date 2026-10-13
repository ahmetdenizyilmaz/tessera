import { useRef, useEffect, useState, useCallback } from 'react';
import { Minus, Plus, Scan, Users } from 'lucide-react';
import { IsometricEngine } from '../../engine/IsometricEngine';
import { OfficeWander } from '../../engine/OfficeWander';
import { placementError } from '../../lib/officeSpace';
import { WorkerAnimator } from '../../engine/WorkerAnimator';
import { getProviderColor } from '../../engine/SpriteManager';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { useInstanceStore } from '../../store/instanceStore';
import { officeProvider } from '../../lib/officeActivity';
import { officeItem, wearableKey } from '../../lib/officeCatalog';
import { bubbleFor, moodFor } from '../../lib/officeBubbles';
import { EXCHANGE_VISIBLE_MS, liveExchanges } from '../../lib/officeTalk';
import { focusShortcutPanel } from '../../lib/panelShortcuts';
import { OfficeCompany } from './OfficeCompany';
import { OfficeHUD } from './OfficeHUD';
import { OfficeShop } from './OfficeShop';
import { OfficeTeam } from './OfficeTeam';
import { OfficeChat } from './OfficeChat';
import { EditModeOverlay } from './EditModeOverlay';
import '../../styles/office.css';

export function OfficeView({ onBack }: { onBack: () => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const storageRef = useRef<HTMLButtonElement>(null);
  const [storageHovered,setStorageHovered]=useState(false);
  const engineRef = useRef<IsometricEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const layout = useOfficeGameStore(s => s.layout);
  const editMode = useOfficeGameStore(s => s.editMode);
  const shopOpen = useOfficeGameStore(s => s.shopOpen);
  const companyOpen = useOfficeGameStore(s=>s.companyOpen);
  const profiles = useOfficeGameStore(s=>s.profiles);
  const location = useOfficeGameStore(s=>s.location);
  const rotation = useOfficeGameStore(s=>s.rotation);
  const movingId = useOfficeGameStore(s=>s.movingId);
  const selectedItem = useOfficeGameStore(s=>s.selectedItem);
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
    const engine = new IsometricEngine(), animator = new WorkerAnimator(), wander=new OfficeWander();
    engineRef.current = engine;
    engine.onWorkerClick(selectAgent);
    engine.onBackgroundClick(closeChat);
    engine.onWorkerHover(id => setHover(id));
    engine.onFurnitureDoubleClick(id=>useOfficeGameStore.getState().beginMove(id));
    engine.setPlacementControls({
      holding:()=>{const s=useOfficeGameStore.getState();return s.editMode && !!(s.movingId || officeItem(s.selectedItem??'')?.furnitureType);},
      rotate:direction=>useOfficeGameStore.setState(s=>({rotation:((s.rotation+direction+4)%4) as 0|1|2|3})),
      storageAt:(x,y)=>{const r=storageRef.current?.getBoundingClientRect();return !!r && x>=r.left && x<=r.right && y>=r.top && y<=r.bottom;},
      storageHover:setStorageHovered,
      store:()=>useOfficeGameStore.getState().storeHeldItem(),
    });
    engine.onTileHover((gridX,gridY)=>{
      const s=useOfficeGameStore.getState();
      const existing=s.layout.furniture.find(f=>f.id===s.movingId), item=officeItem(s.selectedItem??'');
      const type=existing?.type??item?.furnitureType;
      if(!s.editMode || !type || (!existing && s.editAction!=='place')) {engine.showPlacement();return;}
      const f={...existing,id:existing?.id??'preview',type,itemId:existing?.itemId??item?.id,position:{gridX,gridY},rotation:s.rotation};
      engine.showPlacement(f,placementError(s.layout,f,s.workers));
    });
    engine.onTileClick((gridX, gridY) => useOfficeGameStore.getState().placeAt({ gridX, gridY }));
    void engine.init(canvasRef.current).then(() => {
      if (disposed) return;
      const initial = useOfficeGameStore.getState();
      engine.drawFloor(initial.layout); engine.drawWalls(initial.layout); engine.drawFurniture(initial.layout.furniture,initial.profiles);engine.drawExterior(initial.layout,initial.location);
      engine.showGrid(initial.layout, initial.editMode); engine.centerCamera(false); setReady(true);
      let lastTime = performance.now();
      let lastLayout = initial.layout, lastWander=0;
      const targets = new Map<string, string>();
      const loop = (time: number) => {
        if (disposed) return;
        if(document.hidden) {lastTime=time;frameId=requestAnimationFrame(loop);return;}
        const dt = Math.min((time - lastTime) / 1000, .1); lastTime = time;
        const state = useOfficeGameStore.getState(), ids = Object.keys(state.workers);
        engine.syncWorkers(ids);
        if(time-lastWander>1000 && !state.editMode) {
          lastWander=time;
          const changes=wander.update(Date.now(),state.layout,state.workers);
          if(Object.keys(changes).length) useOfficeGameStore.setState({workers:{...state.workers,...changes}});
        }
        for (const id of targets.keys()) if (!state.workers[id]) { targets.delete(id); animator.removeWorker(id); }
        for (const [id, worker] of Object.entries(state.workers)) {
          const key = `${worker.targetPosition.gridX},${worker.targetPosition.gridY}`;
          if (targets.get(id) !== key || lastLayout !== state.layout) { targets.set(id, key); animator.assignPath(id, worker, state.layout); }
        }
        lastLayout = state.layout;
        const poses = animator.update(dt, state.workers);
        engine.updateWorkerPositions(poses);
        const now = Date.now(), exchanges = liveExchanges(now), talking = new Set(exchanges.map(e => e.from));
        for (const [id, worker] of Object.entries(state.workers)) {
          const instance = useInstanceStore.getState().instances.get(id); if (!instance) continue;
          const provider = officeProvider(instance);
          const beat = Math.floor(time / 260);
          engine.updateWorkerGraphic(id, getProviderColor(provider), worker.activity, instance.name, provider,
            wearableKey(state.profiles[id]?.wearables), poses.get(id)?.isWalking, Math.floor(time / 180), state.profiles[id]?.appearanceId, moodFor(worker.activity, talking.has(id), beat),!!poses.get(id)?.seat);
          engine.updateWorkerBubble(id, bubbleFor(worker.activity, talking.has(id)), beat);
        }
        engine.drawLinks(exchanges.map(e => {
          const sender = useInstanceStore.getState().instances.get(e.from);
          return { from: e.from, to: e.to, progress: Math.min(1, (now - e.at) / (EXCHANGE_VISIBLE_MS * .6)), color: getProviderColor(sender ? officeProvider(sender) : '') };
        }));
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
    engine.drawFloor(layout); engine.drawWalls(layout); engine.drawFurniture(layout.furniture,profiles);engine.drawExterior(layout,location); engine.showGrid(layout, editMode);
  }, [layout, editMode, ready, profiles, location]);
  useEffect(()=>{engineRef.current?.refreshPlacement();},[rotation,movingId,selectedItem,layout,editMode]);
  useEffect(()=>{engineRef.current?.highlightWorker(hover??selected);},[hover,selected]);
  useEffect(()=>{if (ready) engineRef.current?.focusWorker(selected);},[ready,selected]);
  useEffect(() => { if (shopOpen || editMode || !selectedInstance) closeChat(); }, [shopOpen, editMode, selectedInstance?.id, closeChat]);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { const s = useOfficeGameStore.getState(); s.setShopOpen(false); s.setEditMode(false); useOfficeGameStore.setState({companyOpen:false});closeChat(); }
      if (e.key.toLowerCase() === 'r' && useOfficeGameStore.getState().editMode && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target instanceof HTMLElement && e.target.isContentEditable))) useOfficeGameStore.setState(s => ({ rotation: ((s.rotation + 1) % 4) as 0 | 1 | 2 | 3 }));
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [closeChat]);
  return <div className={`office-view${selectedInstance ? ' office-view--chat' : ''}${editMode?' office-view--editing':''}`}>
    <OfficeHUD onBack={onBack} />
    <div className="office-stage">
      <div ref={canvasRef} className="office-canvas" aria-label="Animated agent office" />
      {!ready && !error && <div className="office-loading">Opening your office…</div>}
      {error && <div className="office-loading" role="alert">{error}</div>}
      {ready && !count && <div className="office-empty"><Users size={25} /><h3>Your team starts here</h3><p>Open an agent panel and its character will join the office.</p><button onClick={onBack}>Go to panels</button></div>}
      <div className="office-camera"><button aria-label="Zoom out" onClick={() => engineRef.current?.zoomBy(-.15)}><Minus size={16} /></button><button aria-label="Fit office" onClick={() => engineRef.current?.centerCamera()}><Scan size={16} /></button><button aria-label="Zoom in" onClick={() => engineRef.current?.zoomBy(.15)}><Plus size={16} /></button></div>
      <div className="office-map-caption"><span className="office-live-dot" /> LIVE OFFICE <span>{editMode ? 'Click or drag to place · Wheel / R to rotate · Shift + drag to pan' : 'Drag to explore · Scroll to zoom · Double-click furniture to move'}</span></div>
    </div>
    <OfficeTeam selected={selected ?? hover} onSelect={selectAgent} onOpen={openPanel} collapsed={!!selectedInstance} onExpand={closeChat} />
    {selectedInstance && <OfficeChat key={`${selectedInstance.id}:${selectedInstance.claudeSessionId ?? selectedInstance.codexThreadId ?? selectedInstance.opencodeSessionId ?? selectedInstance.antigravityConversationId ?? ''}`} instance={selectedInstance} onClose={closeChat} onOpen={openPanel} />}
    {shopOpen && <OfficeShop />}
    {companyOpen && <OfficeCompany />}
    {editMode && <EditModeOverlay storageRef={storageRef} storageHovered={storageHovered} />}
  </div>;
}
