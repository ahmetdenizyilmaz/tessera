import type { PanelRect } from '../../types/session';
import { useInstanceStore } from '../../store/instanceStore';
import { usePluginStore } from '../../store/pluginStore';
import { useGroupStore } from '../../store/groupStore';
import { sidebarDragState, useLayoutStore } from '../../store/layoutStore';
import { remotePanelByCompositeId } from '../../store/lanStore';

function panelLabel(id: string) {
  const widget = id === '__sidebar-preview__' ? sidebarDragState.kind : useLayoutStore.getState().widgetKinds[id];
  return useInstanceStore.getState().instances.get(id)?.name
    ?? usePluginStore.getState().instances.get(id)?.title
    ?? useGroupStore.getState().groups.get(id)?.name
    ?? remotePanelByCompositeId(id)?.panel.name
    ?? (widget ? widget.charAt(0).toUpperCase() + widget.slice(1).replaceAll('-', ' ') : 'Panel');
}

/** One preview slot per real panel, using the exact committed geometry. */
export function SnapZoneOverlay({ rects, targetId, passthroughIds }: { rects: Map<string, PanelRect>; targetId: string; passthroughIds?: ReadonlySet<string> }) {
  return <div className="snap-layout-preview" style={passthroughIds?.size ? { background: 'transparent' } : undefined} aria-hidden="true">
    {[...rects].filter(([id]) => !passthroughIds?.has(id)).map(([id, r]) => <div key={id} data-preview-panel-id={id}
      className={`snap-zone-preview${id === targetId ? ' snap-zone-preview-target' : ''}`}
      style={{ left: `calc(${r.x}% + 3px)`, top: `calc(${r.y}% + 3px)`, width: `calc(${r.w}% - 6px)`, height: `calc(${r.h}% - 6px)` }}>
      <div className="snap-preview-label"><span>{panelLabel(id)}</span>{id === targetId && <small>Drop here</small>}</div>
    </div>)}
  </div>;
}
