// Real Pixi renderer, synthetic furniture/workers; no running Tessera touched.
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 600 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const base = process.argv[2] ?? 'http://127.0.0.1:1420';
const artifacts = '../tessera-office-validation';
mkdirSync(artifacts, { recursive: true });
try {
  await page.route('**/office-depth-test', route => route.fulfill({ contentType: 'text/html', body:
    '<style>body{margin:0;background:#17282e}#office{height:600px}</style><div id="office"></div>' }));
  await page.goto(`${base}/office-depth-test`);
  await page.evaluate(async () => {
    const { IsometricEngine } = await import('/src/engine/IsometricEngine.ts');
    const { furnitureFootprint, rotatePoint } = await import('/src/lib/officeSpace.ts');
    const engine = window.depthEngine = new IsometricEngine();
    await engine.init(document.getElementById('office'));
    engine.syncWorkers(['worker']);
    window.depthCase = (rotation, side, type = 'couch') => {
      const furniture = { id: 'item', type, rotation, position: { gridX: 2, gridY: 2 } };
      const layout = { width: 6, height: 6, furniture: [furniture], rooms: [], floorTiles: {}, wallTiles: {} };
      engine.drawFloor(layout); engine.drawFurniture([furniture]); engine.centerCamera(false);
      const { w, h } = furnitureFootprint(furniture);
      const [x, y] = { front: [2.15, 2 + h + .35], right: [2 + w + .35, 2.15], back: [2.15, 1.65], left: [1.65, 2.15] }[side] ?? [2.5, 2.5];
      const seat = side === 'seat' ? { furnitureId: 'item', index: 0, position: rotatePoint(furniture, .5, .55), rotation } : undefined;
      engine.updateWorkerPositions(new Map([['worker', { x: x - .5, y: y - .5, direction: 0, isWalking: false, seat }]]));
      engine.updateWorkerGraphic('worker', 0xe99331, 'idle', '', 'claude', '', false, 0, 'depth-worker', '', !!seat);
      engine.app.render();
      const worker = engine.workerGraphics.get('worker').body, item = engine.furnitureGraphics.get('item');
      return { worker: worker.zIndex, furniture: item.zIndex, drawnInFront: engine.entities.getChildIndex(worker) > engine.entities.getChildIndex(item) };
    };
  });
  for (const type of ['couch', 'desk', 'server_rack']) for (let rotation = 0; rotation < 4; rotation++) {
    for (const side of ['front', 'right', 'back', 'left', ...(type === 'couch' ? ['seat'] : [])]) {
      const result = await page.evaluate(({ rotation, side, type }) => window.depthCase(rotation, side, type), { rotation, side, type });
      const front = ['front', 'right', 'seat'].includes(side);
      expect(result.worker > result.furniture, `${type} ${rotation} ${side}`).toBe(front);
      expect(result.drawnInFront).toBe(front);
    }
  }
  for (const side of ['front', 'back', 'seat']) {
    await page.evaluate(side => window.depthCase(0, side), side);
    await page.screenshot({ path: `${artifacts}/office-depth-${side}.png` });
  }
  // Motion must re-sort, and removed bodies must not leave stale graph nodes.
  await page.evaluate(() => {
    const engine = window.depthEngine;
    engine.syncWorkers([]);
    engine.updateWorkerPositions(new Map());
    if ([...engine.depths.values()].some(n => n.id.startsWith('worker:'))) throw new Error('Stale worker depth');
    engine.destroy();
  });
  expect(errors).toEqual([]);
  console.log('PASS real renderer: rotated furniture, all edges, seated workers, moving/resorting and cleanup');
} finally { await browser.close(); }
