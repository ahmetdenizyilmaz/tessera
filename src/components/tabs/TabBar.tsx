import { useState, useCallback, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useLayoutStore } from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import { TabItem } from './TabItem';
import { TabContextMenu } from './TabContextMenu';
import { GroupBreadcrumb } from '../groups/GroupBreadcrumb';
import { NewPanelMenu } from '../plugins/NewPanelMenu';
import { useInstanceStore } from '../../store/instanceStore';
import { usePluginStore } from '../../store/pluginStore';
import { INSTANCE_COLORS } from '../../types/instance';
import { closePanel } from '../../lib/panelCleanup';
import type { LlmProvider } from '../../types/instance';

// Shared drag state for cross-group operations
// Anchored to globalThis to survive HMR
export const crossGroupDragState: {
  activeDragId: string | null;
  overDropTargetId: string | null;
  overDropTargetType: 'group-tab' | 'breadcrumb' | 'navigate-up' | null;
} = (globalThis as any).__crossGroupDragState ??= {
  activeDragId: null,
  overDropTargetId: null,
  overDropTargetType: null,
};

// Custom collision detection: prioritize breadcrumb/group droppables over sortable tabs
// when the pointer is directly over them. Falls back to closestCenter for tab reordering.
const crossGroupCollision: CollisionDetection = (args) => {
  // First, check if pointer is directly within any droppable
  const pointerCollisions = pointerWithin(args);

  // Prioritize breadcrumb and navigate-up droppables
  const breadcrumbCollision = pointerCollisions.find((c) => {
    const id = String(c.id);
    return id.startsWith('breadcrumb-') || id === 'breadcrumb-navigate-up';
  });
  if (breadcrumbCollision) return [breadcrumbCollision];

  // Prioritize group tab droppables (pointer must be directly over them)
  const pointerGroupCollision = pointerCollisions.find((c) => {
    const id = String(c.id);
    const panelType = useLayoutStore.getState().panelTypes[id];
    return panelType === 'group' && id !== String(args.active.id);
  });
  if (pointerGroupCollision) return [pointerGroupCollision];

  // Fall back to closestCenter for regular tab sorting
  return closestCenter(args);
};

const EMPTY_TAB_ORDER: string[] = [];

interface TabBarProps {
  onNewInstance?: () => void;
  onNewInstanceSettings?: () => void;
  onNewLlmChat?: (provider?: Exclude<LlmProvider, 'claude'>) => void;
  onNewGroup?: () => void;
  onNewPlugin?: (pluginName: string) => void;
}

export function TabBar({ onNewInstance, onNewInstanceSettings, onNewLlmChat, onNewGroup, onNewPlugin }: TabBarProps) {
  const tabOrder = useLayoutStore((s) => s.tabOrder ?? EMPTY_TAB_ORDER);
  const moveTab = useLayoutStore((s) => s.moveTab);
  const panelTypes = useLayoutStore((s) => s.panelTypes);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  // Timer for "navigate up" hover zone
  const navigateUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const dragId = String(event.active.id);
    setActiveDragId(dragId);
    crossGroupDragState.activeDragId = dragId;
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      crossGroupDragState.overDropTargetId = null;
      crossGroupDragState.overDropTargetType = null;
      if (navigateUpTimerRef.current) {
        clearTimeout(navigateUpTimerRef.current);
        navigateUpTimerRef.current = null;
      }
      return;
    }

    const overId = String(over.id);

    // Check if hovering over a "navigate-up" zone
    if (overId === 'breadcrumb-navigate-up') {
      if (crossGroupDragState.overDropTargetType !== 'navigate-up') {
        crossGroupDragState.overDropTargetId = overId;
        crossGroupDragState.overDropTargetType = 'navigate-up';
        // Start a 500ms timer to navigate up
        if (navigateUpTimerRef.current) clearTimeout(navigateUpTimerRef.current);
        navigateUpTimerRef.current = setTimeout(() => {
          const groupStack = useGroupStore.getState().groupStack;
          if (groupStack.length > 0) {
            useGroupStore.getState().exitGroup();
          }
          navigateUpTimerRef.current = null;
        }, 500);
      }
      return;
    }

    // Clear navigate-up timer if we moved away
    if (navigateUpTimerRef.current) {
      clearTimeout(navigateUpTimerRef.current);
      navigateUpTimerRef.current = null;
    }

    // Check if hovering over a breadcrumb drop target
    if (overId.startsWith('breadcrumb-')) {
      crossGroupDragState.overDropTargetId = overId;
      crossGroupDragState.overDropTargetType = 'breadcrumb';
      return;
    }

    // Check if hovering over a group tab (the tab is in tabOrder and its type is 'group')
    const overPanelType = useLayoutStore.getState().panelTypes[overId];
    if (overPanelType === 'group' && overId !== String(event.active.id)) {
      crossGroupDragState.overDropTargetId = overId;
      crossGroupDragState.overDropTargetType = 'group-tab';
      return;
    }

    // Regular tab reorder - clear cross-group state
    crossGroupDragState.overDropTargetId = null;
    crossGroupDragState.overDropTargetType = null;
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      // Clear navigate-up timer
      if (navigateUpTimerRef.current) {
        clearTimeout(navigateUpTimerRef.current);
        navigateUpTimerRef.current = null;
      }

      // Reset drag state
      setActiveDragId(null);
      crossGroupDragState.activeDragId = null;
      crossGroupDragState.overDropTargetId = null;
      crossGroupDragState.overDropTargetType = null;

      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Don't allow moving a group into itself
      if (activeId === overId) return;

      // --- Cross-group: Drop on breadcrumb segment ---
      if (overId.startsWith('breadcrumb-')) {
        const targetGroupId = overId === 'breadcrumb-root' ? null : overId.replace('breadcrumb-', '');
        const currentGroupId = useGroupStore.getState().getCurrentGroupId();

        // If we're at root and dropping on root, nothing to do
        if (currentGroupId === null && targetGroupId === null) return;

        // Move the panel from current group to the target group/root
        if (currentGroupId !== null) {
          // Remove from current group
          useGroupStore.getState().removeFromGroup(currentGroupId, activeId);
        }

        // Remove from current tabOrder (visible level)
        useLayoutStore.getState().removePanel(activeId);

        // Add to target group or root
        if (targetGroupId !== null) {
          useGroupStore.getState().addToGroup(targetGroupId, activeId);
        } else {
          // Add to root tabOrder
          useLayoutStore.getState().addPanel(activeId, panelTypes[activeId] ?? 'terminal');
        }
        return;
      }

      // --- Cross-group: Drop on group tab ---
      const overPanelType = useLayoutStore.getState().panelTypes[overId];
      if (overPanelType === 'group') {
        const currentGroupId = useGroupStore.getState().getCurrentGroupId();

        // Remove from current level
        if (currentGroupId !== null) {
          useGroupStore.getState().removeFromGroup(currentGroupId, activeId);
        }
        useLayoutStore.getState().removePanel(activeId);

        // Add to the target group
        useGroupStore.getState().addToGroup(overId, activeId);
        return;
      }

      // --- Regular tab reorder ---
      const fromIndex = tabOrder.indexOf(activeId);
      const toIndex = tabOrder.indexOf(overId);
      if (fromIndex !== -1 && toIndex !== -1) {
        moveTab(fromIndex, toIndex);
      }
    },
    [tabOrder, moveTab, panelTypes],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    crossGroupDragState.activeDragId = null;
    crossGroupDragState.overDropTargetId = null;
    crossGroupDragState.overDropTargetType = null;
    if (navigateUpTimerRef.current) {
      clearTimeout(navigateUpTimerRef.current);
      navigateUpTimerRef.current = null;
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  const handleRename = useCallback(() => {
    if (!contextMenu) return;
    const panelType = useLayoutStore.getState().panelTypes[contextMenu.tabId];
    if (panelType === 'group') {
      const group = useGroupStore.getState().groups.get(contextMenu.tabId);
      if (!group) return;
      const newName = prompt('Rename group:', group.name);
      if (newName && newName.trim()) {
        useGroupStore.getState().renameGroup(contextMenu.tabId, newName.trim());
      }
      return;
    }
    if (panelType === 'plugin') {
      const pi = usePluginStore.getState().instances.get(contextMenu.tabId);
      if (!pi) return;
      const newName = prompt('Rename plugin:', pi.title);
      if (newName && newName.trim()) {
        usePluginStore.getState().setInstanceTitle(contextMenu.tabId, newName.trim());
      }
      return;
    }
    const instance = useInstanceStore.getState().getInstance(contextMenu.tabId);
    if (!instance) return;
    const newName = prompt('Rename instance:', instance.name);
    if (newName && newName.trim()) {
      useInstanceStore.getState().setName(contextMenu.tabId, newName.trim());
    }
  }, [contextMenu]);

  const handleChangeColor = useCallback(() => {
    if (!contextMenu) return;
    const panelType = useLayoutStore.getState().panelTypes[contextMenu.tabId];
    if (panelType === 'group' || panelType === 'widget' || panelType === 'plugin') {
      // Groups/widgets/plugins don't use instance color cycling (yet)
      return;
    }
    const instance = useInstanceStore.getState().getInstance(contextMenu.tabId);
    if (!instance) return;
    const currentIdx = INSTANCE_COLORS.indexOf(instance.color);
    const nextColor = INSTANCE_COLORS[(currentIdx + 1) % INSTANCE_COLORS.length];
    useInstanceStore.getState().setColor(contextMenu.tabId, nextColor);
  }, [contextMenu]);

  const handleCloseTab = useCallback(async () => {
    if (!contextMenu) return;
    await closePanel(contextMenu.tabId);
  }, [contextMenu]);

  return (
    <div className="tab-bar">
      <DndContext
        sensors={sensors}
        collisionDetection={crossGroupCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Breadcrumb (only visible when inside a group) - must be inside DndContext for droppables */}
        <GroupBreadcrumb />

        <SortableContext
          items={tabOrder}
          strategy={horizontalListSortingStrategy}
        >
          <div className="tab-bar-tabs">
            {tabOrder.map((id) => (
              <TabItem
                key={id}
                id={id}
                onContextMenu={handleContextMenu}
                isDragActive={activeDragId !== null}
                dragSourceId={activeDragId}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <div className="tab-item tab-item-active" style={{ opacity: 0.8, cursor: 'grabbing' }}>
              <span className="tab-name" style={{ fontSize: 12 }}>
                {(() => {
                  const pt = panelTypes[activeDragId];
                  if (pt === 'group') {
                    const g = useGroupStore.getState().groups.get(activeDragId);
                    return g?.name ?? 'Group';
                  }
                  if (pt === 'widget') return 'Widget';
                  const inst = useInstanceStore.getState().getInstance(activeDragId);
                  return inst?.name ?? activeDragId;
                })()}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div style={{ position: 'relative' }}>
        <button
          className="tab-bar-add"
          onClick={() => setShowAddMenu((v) => !v)}
          title="New instance"
        >
          +
        </button>
        {showAddMenu && (
          <NewPanelMenu
            onClose={() => setShowAddMenu(false)}
            onNewChat={() => onNewInstance?.()}
            onNewChatSettings={onNewInstanceSettings ? () => onNewInstanceSettings() : undefined}
            onNewLlmChat={(p) => onNewLlmChat?.(p)}
            onNewGroup={() => onNewGroup?.()}
            onNewPlugin={(name) => onNewPlugin?.(name)}
          />
        )}
      </div>

      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tabId={contextMenu.tabId}
          onRename={handleRename}
          onChangeColor={handleChangeColor}
          onClose={handleCloseTab}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
