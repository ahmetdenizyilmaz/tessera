import { describe, expect, it, vi } from 'vitest';
import { OfficeCamera } from './OfficeCamera';

describe('office camera movement', () => {
  it('eases through intermediate positions and finishes exactly, without overshoot', () => {
    const camera = new OfficeCamera();
    camera.moveTo({ x: 100, y: -50, zoom: 2 }, true, 0);
    expect(camera.current.zoom).toBe(1);
    camera.step(100);
    expect(camera.current.zoom).toBeGreaterThan(1); expect(camera.current.zoom).toBeLessThan(2);
    camera.step(420);
    expect(camera.current).toEqual({ x:100,y:-50,zoom:2 }); expect(camera.moving).toBe(false);
  });
  it('switches targets from the current frame and handles resize during the move', () => {
    const camera = new OfficeCamera();
    camera.moveTo({ x: 100,y:200,zoom:2 }, true, 0); camera.step(150);
    const before = { ...camera.current };
    camera.moveTo({ x: -100,y:0,zoom:1 }, true, 150);
    expect(camera.current).toEqual(before);
    camera.resize(-60, 30); camera.step(570);
    expect(camera.current).toEqual({ x:-160,y:30,zoom:1 });
  });
  it('keeps the cursor world point fixed throughout a wheel zoom and cancels on pan', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const camera = new OfficeCamera();
    camera.moveTo({ x: -40, y: 10, zoom: 1 }, false);
    const anchor = {x:100,y:80}, world = {x:140,y:70};
    camera.zoomBy(.5,anchor);
    for (const time of [50,150,300,420]) {
      camera.step(time);
      expect(camera.current.x+world.x*camera.current.zoom).toBeCloseTo(anchor.x);
      expect(camera.current.y+world.y*camera.current.zoom).toBeCloseTo(anchor.y);
    }
    vi.mocked(performance.now).mockReturnValue(500);
    camera.moveTo({x:300,y:20,zoom:2});
    const before={...camera.current}; camera.pan(20,-10);
    expect(camera.current).toEqual({...before,x:before.x+20,y:before.y-10}); expect(camera.moving).toBe(false);
    camera.zoomBy(100,anchor,false); expect(camera.current.zoom).toBe(2.5);
    camera.zoomBy(-100,anchor,false); expect(camera.current.zoom).toBe(.25);
    vi.restoreAllMocks();
  });
});
