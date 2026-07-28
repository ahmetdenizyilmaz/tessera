import { useRef, useEffect, useState } from 'react';
import { IsometricEngine } from '../../engine/IsometricEngine';
import { WorkerAnimator } from '../../engine/WorkerAnimator';
import { getProviderColor } from '../../engine/SpriteManager';
import { getDefaultLayout } from '../../engine/defaultOffice';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useSalaryEngine } from '../../store/salaryEngine';
import { OfficeHUD } from './OfficeHUD';
import { OfficeShop } from './OfficeShop';
import { WorkerTooltip } from './WorkerTooltip';
import { EditModeOverlay } from './EditModeOverlay';
import '../../styles/office.css';

interface OfficeViewProps {
  onBack: () => void;
}

export function OfficeView({ onBack }: OfficeViewProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<IsometricEngine | null>(null);
  const animatorRef = useRef(new WorkerAnimator());
  const animFrameRef = useRef(0);
  const lastTimeRef = useRef(0);

  // Local positions — updated every frame WITHOUT touching Zustand
  const localPositions = useRef(new Map<string, { x: number; y: number }>());

  const [hoveredWorker, setHoveredWorker] = useState<{ id: string; x: number; y: number } | null>(null);

  const layout = useOfficeGameStore(s => s.layout);
  const editMode = useOfficeGameStore(s => s.editMode);
  const shopOpen = useOfficeGameStore(s => s.shopOpen);

  useSalaryEngine();

  // Initialize engine
  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new IsometricEngine();
    engineRef.current = engine;

    const store = useOfficeGameStore.getState();
    if (store.layout.furniture.length === 0 && store.layout.rooms.length === 0) {
      store.setLayout(getDefaultLayout());
    }

    engine.init(canvasRef.current).then(() => {
      const currentLayout = useOfficeGameStore.getState().layout;
      engine.drawFloor(currentLayout);
      engine.drawWalls(currentLayout);
      engine.drawFurniture(currentLayout.furniture);

      engine.onWorkerHover((id, sx, sy) => {
        setHoveredWorker(id ? { id, x: sx, y: sy } : null);
      });

      engine.onWorkerClick((instanceId) => {
        onBack();
        setTimeout(() => useLayoutStore.getState().setActiveTab(instanceId), 50);
      });

      // Track last known worker set to detect changes
      let lastWorkerIds = '';
      let lastActivities = '';
      const lastTargets = new Map<string, string>();

      lastTimeRef.current = performance.now();
      const loop = (time: number) => {
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1); // cap dt
        lastTimeRef.current = time;

        const workers = useOfficeGameStore.getState().workers;
        const currentLayout = useOfficeGameStore.getState().layout;

        // Detect worker add/remove (cheap string comparison)
        const workerIds = Object.keys(workers);
        const idsKey = workerIds.join(',');
        if (idsKey !== lastWorkerIds) {
          lastWorkerIds = idsKey;
          engine.syncWorkers(workerIds);
        }

        // Detect target changes and trigger pathfinding
        for (const [id, worker] of Object.entries(workers)) {
          const targetKey = `${worker.targetPosition.gridX},${worker.targetPosition.gridY}`;
          if (lastTargets.get(id) !== targetKey) {
            lastTargets.set(id, targetKey);
            animatorRef.current.assignPath(id, worker, currentLayout);
          }
        }
        // Clean up stale targets
        for (const id of lastTargets.keys()) {
          if (!workers[id]) lastTargets.delete(id);
        }

        // Run animator — returns positions without touching the store
        const updates = animatorRef.current.update(dt, workers);

        // Update local positions and push to engine
        for (const [id, upd] of updates) {
          localPositions.current.set(id, { x: upd.x, y: upd.y });
        }
        engine.updateWorkerPositions(localPositions.current);

        // Only redraw worker graphics when activity changes (not every frame)
        const activitiesKey = workerIds.map(id => workers[id]?.activity ?? '').join(',');
        if (activitiesKey !== lastActivities) {
          lastActivities = activitiesKey;
          const instances = useInstanceStore.getState().instances;
          for (const [id, worker] of Object.entries(workers)) {
            const instance = instances.get(id);
            if (instance) {
              const provider = instance.config.llmConfig?.provider ?? 'claude';
              engine.updateWorkerGraphic(id, getProviderColor(provider), worker.activity, instance.name);
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(loop);
      };
      animFrameRef.current = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      engine.destroy();
      engineRef.current = null;
    };
  }, [onBack]);

  // Sync layout changes (furniture/tiles edited)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.drawFloor(layout);
    engine.drawWalls(layout);
    engine.drawFurniture(layout.furniture);
  }, [layout]);

  // Toggle edit grid
  useEffect(() => {
    engineRef.current?.showGrid(layout, editMode);
  }, [editMode, layout]);

  return (
    <div className="office-view">
      <div ref={canvasRef} className="office-canvas" />
      <OfficeHUD onBack={onBack} />
      {shopOpen && <OfficeShop />}
      {hoveredWorker && (
        <WorkerTooltip
          instanceId={hoveredWorker.id}
          screenX={hoveredWorker.x}
          screenY={hoveredWorker.y}
        />
      )}
      {editMode && <EditModeOverlay engine={engineRef.current} />}
    </div>
  );
}
