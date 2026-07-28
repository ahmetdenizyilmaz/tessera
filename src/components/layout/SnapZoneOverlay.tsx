import type { SnapZone } from '../../types/session';

interface SnapZoneOverlayProps {
  zone: SnapZone;
  containerRect: { width: number; height: number };
}

function getZoneRect(zone: SnapZone): { x: number; y: number; w: number; h: number } {
  switch (zone) {
    case 'left':         return { x: 0,  y: 0,  w: 50,  h: 100 };
    case 'right':        return { x: 50, y: 0,  w: 50,  h: 100 };
    case 'top':          return { x: 0,  y: 0,  w: 100, h: 50 };
    case 'bottom':       return { x: 0,  y: 50, w: 100, h: 50 };
    case 'top-left':     return { x: 0,  y: 0,  w: 50,  h: 50 };
    case 'top-right':    return { x: 50, y: 0,  w: 50,  h: 50 };
    case 'bottom-left':  return { x: 0,  y: 50, w: 50,  h: 50 };
    case 'bottom-right': return { x: 50, y: 50, w: 50,  h: 50 };
    case 'center':       return { x: 10, y: 10, w: 80,  h: 80 };
  }
}

export function SnapZoneOverlay({ zone, containerRect }: SnapZoneOverlayProps) {
  const zr = getZoneRect(zone);

  // Visual styling (background, border, z-index, transition) comes from the
  // .snap-zone-preview class in mosaic.css — only the geometry is inline
  return (
    <div
      className="snap-zone-preview"
      style={{
        left: `${(zr.x / 100) * containerRect.width}px`,
        top: `${(zr.y / 100) * containerRect.height}px`,
        width: `${(zr.w / 100) * containerRect.width}px`,
        height: `${(zr.h / 100) * containerRect.height}px`,
      }}
    />
  );
}
