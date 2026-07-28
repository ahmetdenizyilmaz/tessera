import { useState, useEffect } from 'react';
import { ArrowLeft, Folder, ChevronRight } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useGroupStore, EMPTY_GROUP_STACK } from '../../store/groupStore';
import type { BreadcrumbSegment } from '../../store/groupStore';

// ─── Individual Breadcrumb Segment (droppable) ──────────────────────────────

interface BreadcrumbDropSegmentProps {
  segment: BreadcrumbSegment;
  isLast: boolean;
  index: number;
}

function BreadcrumbDropSegment({ segment, isLast, index }: BreadcrumbDropSegmentProps) {
  const jumpToLevel = useGroupStore((s) => s.jumpToLevel);

  const droppableId = segment.id === null ? 'breadcrumb-root' : `breadcrumb-${segment.id}`;
  // Don't allow dropping on the last segment (current level) - no-op
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    disabled: isLast,
  });

  const isHighlighted = isOver && !isLast;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        animation: `breadcrumb-slide-in 0.25s ease ${index * 0.05}s both`,
      }}
    >
      {index > 0 && (
        <ChevronRight
          size={10}
          style={{ color: 'var(--text-muted)', flexShrink: 0 }}
        />
      )}
      <button
        ref={setNodeRef}
        onClick={(e) => {
          e.stopPropagation();
          jumpToLevel(segment.id);
        }}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className={isHighlighted ? 'breadcrumb-drop-target' : ''}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '2px 5px',
          background: isHighlighted ? 'rgba(74, 158, 255, 0.15)' : 'none',
          border: isHighlighted ? '1px solid rgba(74, 158, 255, 0.5)' : '1px solid transparent',
          borderRadius: 3,
          color: isHighlighted
            ? 'var(--accent)'
            : isLast
              ? 'var(--text-primary)'
              : 'var(--text-muted)',
          fontWeight: isLast ? 600 : 400,
          fontSize: 11,
          cursor: isLast ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
          transition: 'color 0.15s, background 0.15s, border-color 0.15s, box-shadow 0.15s',
          boxShadow: isHighlighted ? '0 0 6px rgba(74, 158, 255, 0.3)' : 'none',
        }}
        onMouseEnter={(e) => {
          if (!isLast && !isHighlighted) {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isLast && !isHighlighted) {
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.background = 'none';
          }
        }}
      >
        {index === 0 && (
          <Folder
            size={11}
            style={{ flexShrink: 0 }}
          />
        )}
        {segment.name}
      </button>
    </div>
  );
}

// ─── Navigate Up Zone (droppable, triggers exitGroup after 500ms hover) ─────

function NavigateUpZone() {
  const { setNodeRef, isOver } = useDroppable({
    id: 'breadcrumb-navigate-up',
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        zIndex: 20,
        background: isOver ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
        transition: 'background 0.2s',
      }}
    />
  );
}

// ─── Main Breadcrumb Component ──────────────────────────────────────────────

export function GroupBreadcrumb() {
  const groupStack = useGroupStore((s) => s.groupStack ?? EMPTY_GROUP_STACK);
  const exitGroup = useGroupStore((s) => s.exitGroup);
  const getBreadcrumb = useGroupStore((s) => s.getBreadcrumb);

  const isVisible = groupStack.length > 0;

  // Delayed unmount: keep content mounted during the exit animation
  const [shouldRender, setShouldRender] = useState(isVisible);
  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
    } else {
      const timer = setTimeout(() => setShouldRender(false), 350);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  const breadcrumb = shouldRender ? getBreadcrumb() : [];

  // Don't render anything if fully hidden and unmounted
  if (!shouldRender && !isVisible) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        maxWidth: isVisible ? 500 : 0,
        opacity: isVisible ? 1 : 0,
        paddingLeft: isVisible ? 4 : 0,
        paddingRight: isVisible ? 8 : 0,
        gap: isVisible ? 4 : 0,
        transition: 'max-width 0.3s ease, opacity 0.25s ease, padding 0.3s ease, gap 0.3s ease',
      }}
    >
      {/* Navigate-up drop zone at the very top of the breadcrumb area */}
      <NavigateUpZone />

      {/* Back button - visually prominent */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          exitGroup();
        }}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 24,
          background: 'rgba(74, 158, 255, 0.1)',
          border: '1px solid rgba(74, 158, 255, 0.3)',
          borderRadius: 5,
          color: 'var(--accent)',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.15s, border-color 0.15s, transform 0.25s ease, opacity 0.25s ease',
          transform: isVisible ? 'translateX(0)' : 'translateX(-12px)',
          opacity: isVisible ? 1 : 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(74, 158, 255, 0.2)';
          e.currentTarget.style.borderColor = 'rgba(74, 158, 255, 0.5)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(74, 158, 255, 0.1)';
          e.currentTarget.style.borderColor = 'rgba(74, 158, 255, 0.3)';
        }}
        title="Go back one level"
      >
        <ArrowLeft size={14} />
      </button>

      {/* Breadcrumb segments - each is a droppable target */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          fontSize: 11,
          overflow: 'hidden',
        }}
      >
        {breadcrumb.map((segment, i) => {
          const isLast = i === breadcrumb.length - 1;
          return (
            <BreadcrumbDropSegment
              key={segment.id ?? 'root'}
              segment={segment}
              isLast={isLast}
              index={i}
            />
          );
        })}
      </div>

      {/* Separator line */}
      <div
        style={{
          width: 1,
          height: 16,
          background: 'var(--border)',
          marginLeft: 4,
          flexShrink: 0,
          opacity: isVisible ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
      />
    </div>
  );
}
