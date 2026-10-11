import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, pointerWithin, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, Plus, X, ExternalLink } from 'lucide-react';
import { useWorkspaceWindowStore, type DetachedWorkspace } from '../../store/workspaceWindowStore';
import { useGroupStore } from '../../store/groupStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useInstanceStore } from '../../store/instanceStore';
import { usePluginStore } from '../../store/pluginStore';
import { detachedViews, ensureDetachedView, closeDetachedWorkspace, copyWindowStyles, beginWindowPanelDrag, endWindowPanelDrag, finishWindowTabDrag, detachPanel, movePanelToWindow, windowLabel, isExitingWindows } from '../../lib/workspaceWindows';
import { useWindowDragStore } from '../../store/windowDragStore';
import { closePanel } from '../../lib/panelCleanup';
import { notify } from '../../lib/toast';
import { createGroupPanel, createPluginPanel, openNewSessionWizard } from '../../lib/newSessionActions';
import { captureGroupSnapshot, getPanelLocations } from '../../store/groupStore';
import { MosaicLayout } from '../layout/MosaicLayout';
import { connectDetachedLayout, createDetachedLayout } from '../../lib/detachedLayout';
import { PanelWindowContext } from './PanelWindowContext';
import './windows.css';

function panelName(id: string): string {
  return useInstanceStore.getState().instances.get(id)?.name ?? usePluginStore.getState().instances.get(id)?.title
    ?? useGroupStore.getState().groups.get(id)?.name ?? (useLayoutStore.getState().widgetKinds[id] === 'new-session' ? 'New session' : 'Panel');
}

function DetachedTab({ id, active, select, menu }: { id: string; active: boolean; select: () => void; menu: (x: number, y: number) => void }) {
  useInstanceStore(s => s.instances.get(id)?.name);
  usePluginStore(s => s.instances.get(id)?.title);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <div ref={setNodeRef} {...attributes} {...listeners} role="tab" aria-selected={active}
    onPointerDown={e => { if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId); listeners?.onPointerDown?.(e); }}
    className={`detached-tab ${active ? 'detached-tab-active' : ''}`} data-tab-id={id}
    style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .5 : 1 }}
    onClick={select} onContextMenu={e => { e.preventDefault(); menu(e.clientX, e.clientY); }} title={`${panelName(id)} — drag to move between windows`}>
    <span>{panelName(id)}</span><button aria-label={`Close ${panelName(id)}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); void closePanel(id); }}><X size={13} /></button>
  </div>;
}

function DetachedWorkspaceView({ workspace, child }: { workspace: DetachedWorkspace; child: Window }) {
  const groups = useGroupStore(s => s.groups);
  const [path, setPath] = useState<string[]>([]);
  const [newMenu, setNewMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const groupId = path.filter(id => groups.has(id)).at(-1) ?? workspace.groupId;
  const layout = useMemo(() => createDetachedLayout(groupId), [groupId]);
  useLayoutEffect(() => connectDetachedLayout(layout, groupId), [layout, groupId]);
  const ids = layout(s => s.tabOrder);
  const active = layout(s => s.activeTabId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const select = (id: string) => { layout.getState().setActiveTab(id); layout.getState().setFocused(id); };
  const label = windowLabel(workspace.id);
  const enterGroup = useCallback((id: string) => setPath(previous => [...previous, id]), []);
  useEffect(() => {
    child.document.documentElement.dataset.workspaceGroup = groupId;
    return () => { delete child.document.documentElement.dataset.workspaceGroup; };
  }, [child, groupId]);
  useEffect(() => {
    const focus = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const locations = getPanelLocations(captureGroupSnapshot());
      const next: string[] = [];
      let parent = locations.get(id);
      while (parent && parent !== workspace.groupId && !next.includes(parent)) {
        next.unshift(parent);
        parent = locations.get(parent);
      }
      if (parent !== workspace.groupId) return;
      setPath(next);
      useGroupStore.getState().setGroupActiveChild(next.at(-1) ?? workspace.groupId, id);
    };
    child.addEventListener('tessera-focus-panel', focus);
    return () => child.removeEventListener('tessera-focus-panel', focus);
  }, [child, workspace.groupId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setNewMenu(false); setContextMenu(null); }
      if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); openNewSessionWizard(groupId); }
      if (event.ctrlKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        if (event.shiftKey) void closeDetachedWorkspace(workspace.id); else if (active) void closePanel(active);
      }
      if (event.ctrlKey && event.key === 'Tab' && ids.length) {
        event.preventDefault(); layout.getState().cycleFocus(event.shiftKey ? -1 : 1);
      }
    };
    child.addEventListener('keydown', key);
    return () => child.removeEventListener('keydown', key);
  }, [child, active, ids.join('|'), workspace.id, groupId, layout]);
  const dragEnd = async (event: DragEndEvent) => {
    setDragging(false);
    const moved = await finishWindowTabDrag(String(event.active.id), label);
    endWindowPanelDrag();
    if (moved || !event.over || event.active.id === event.over.id) return;
    const target = String(event.over.id);
    if (useLayoutStore.getState().panelTypes[target] === 'group') {
      useGroupStore.getState().movePanelToLevel(String(event.active.id), target);
      return;
    }
    const from = ids.indexOf(String(event.active.id)), to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    layout.getState().moveTab(from, to);
  };
  const newPlugin = (name: string) => {
    createPluginPanel(name, groupId);
    setNewMenu(false);
  };
  return <PanelWindowContext.Provider value={{ document: child.document, label, enterGroup, layout }}>
    <div className="detached-workspace" onPointerDown={() => { if (contextMenu) setContextMenu(null); }}>
      <div className="detached-tabs" role="tablist" data-window-tabstrip={label}>
        {path.length > 0 && <button className="detached-tool" title="Back to parent group" onClick={() => setPath(p => p.slice(0, -1))}><ArrowLeft size={15} /></button>}
        <DndContext sensors={sensors} collisionDetection={pointerWithin}
          onDragStart={event => { setDragging(true); beginWindowPanelDrag(String(event.active.id), label, event.activatorEvent); }} onDragEnd={dragEnd}
          onDragCancel={() => { setDragging(false); endWindowPanelDrag(); }}>
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {ids.map(id => <DetachedTab key={id} id={id} active={id === active} select={() => select(id)} menu={(x, y) => setContextMenu({ id, x, y })} />)}
          </SortableContext>
        </DndContext>
        <div className="detached-new"><button className="detached-tool" title="Add a panel" onClick={() => setNewMenu(v => !v)}><Plus size={16} /></button>
          {newMenu && <div className="menu-dropdown" data-browser-overlay>
            <button className="menu-dropdown-item" onClick={() => { openNewSessionWizard(groupId); setNewMenu(false); }}>New session</button>
            <button className="menu-dropdown-item" onClick={() => { createGroupPanel(groupId); setNewMenu(false); }}>New group</button>
            {[...usePluginStore.getState().registry.values()].map(plugin => <button key={plugin.name} className="menu-dropdown-item" onClick={() => newPlugin(plugin.name)}>{plugin.defaultTitle}</button>)}
          </div>}
        </div>
        {active && <button className="detached-tool" title="Move active panel back to main window" onClick={() => movePanelToWindow(active, null)}><ExternalLink size={14} /></button>}
      </div>
      {contextMenu && <div className="context-menu" style={{ position: 'fixed', left: Math.min(contextMenu.x, child.innerWidth - 230), top: contextMenu.y, zIndex: 10000 }} onPointerDown={e => e.stopPropagation()}>
        <button className="menu-dropdown-item" onClick={() => { void detachPanel(contextMenu.id); setContextMenu(null); }}>Move to new window</button>
        <button className="menu-dropdown-item" onClick={() => { movePanelToWindow(contextMenu.id, null); setContextMenu(null); }}>Move to main window</button>
        <button className="menu-dropdown-item" onClick={() => { void closePanel(contextMenu.id); setContextMenu(null); }}>Close panel</button>
      </div>}
      <div className="detached-content" style={{ pointerEvents: dragging ? 'none' : undefined }}>
        <MosaicLayout key={groupId} />
      </div>
    </div>
  </PanelWindowContext.Provider>;
}

function WindowDragHint() {
  const drag = useWindowDragStore(s => s.drag);
  if (!drag?.hint) return null;
  const child = [...detachedViews.entries()].find(([id]) => windowLabel(id) === drag.source)?.[1];
  const doc = drag.source === 'main' ? document : child?.document;
  if (!doc) return null;
  return createPortal(<div className="window-drag-hint" style={{ left: Math.max(8, Math.min(drag.x + 18, (doc.defaultView?.innerWidth ?? 800) - 220)), top: Math.max(8, Math.min(drag.y + 26, (doc.defaultView?.innerHeight ?? 600) - 40)) }}>{drag.hint}</div>, doc.body);
}

export function DetachedWindows() {
  const workspaces = useWorkspaceWindowStore(s => s.windows);
  const groups = useGroupStore(s => s.groups);
  const [, refresh] = useState(0);
  const previousIds = useRef(new Set<string>());
  useEffect(() => {
    if (isExitingWindows()) return;
    let cancelled = false;
    for (const workspace of workspaces) {
      if (!groups.get(workspace.groupId)?.childIds.length) {
        void closeDetachedWorkspace(workspace.id, false);
        continue;
      }
      if (!detachedViews.has(workspace.id)) {
        void ensureDetachedView(workspace).then(() => { if (!cancelled) refresh(n => n + 1); }).catch(error => {
          notify(String(error));
          // Failed restore must leave every panel reachable in Main.
          for (const id of useGroupStore.getState().groups.get(workspace.groupId)?.childIds ?? []) movePanelToWindow(id, null);
          void closeDetachedWorkspace(workspace.id, false);
        });
      }
    }
    for (const id of previousIds.current) {
      if (!workspaces.some(w => w.id === id)) void closeDetachedWorkspace(id, false);
    }
    previousIds.current = new Set(workspaces.map(w => w.id));
    return () => { cancelled = true; };
  }, [workspaces, groups]);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      for (const child of detachedViews.values()) if (!child.closed) copyWindowStyles(child.document);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    observer.observe(document.head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return <><WindowDragHint />{workspaces.map(workspace => {
    const child = detachedViews.get(workspace.id);
    const root = child && !child.closed ? child.document.getElementById('detached-root') : null;
    return root ? createPortal(<DetachedWorkspaceView workspace={workspace} child={child!} />, root, workspace.id) : null;
  })}</>;
}
