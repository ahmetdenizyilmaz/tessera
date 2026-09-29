import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, FolderInput, LayoutGrid, Plus, Search, X } from 'lucide-react';
import { useGroupStore } from '../../store/groupStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useInstanceStore } from '../../store/instanceStore';
import { usePluginStore } from '../../store/pluginStore';
import { getExistingPanelOptions, getGroupMoveOptions } from '../../lib/groupPanelOptions';
import '../../styles/group-panel-picker.css';

type PickerTarget = { panelId: string; groupId?: never } | { groupId: string; panelId?: never };

function useWorkspaceMembership() {
  useGroupStore(s => s.groups);
  useGroupStore(s => s.groupStack);
  useLayoutStore(s => s.tabOrder);
  useLayoutStore(s => s.panelTypes);
}

export function GroupPanelPicker({ onClose, ...target }: PickerTarget & { onClose: () => void }) {
  useWorkspaceMembership();
  useInstanceStore(s => s.instances);
  usePluginStore(s => s.instances);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const isAdding = target.groupId !== undefined;
  const options = target.groupId !== undefined
    ? getExistingPanelOptions(target.groupId)
    : getGroupMoveOptions(target.panelId);
  const visible = options.filter(option => `${option.name} ${option.location}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedIds = options.flatMap(option => option.id !== null && selected.has(option.id) ? [option.id] : []);
  const groupName = useGroupStore(s => target.groupId === undefined ? '' : s.groups.get(target.groupId)?.name ?? 'group');

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector('input')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  const addSelected = () => {
    if (target.groupId === undefined) return;
    for (const id of selectedIds) useGroupStore.getState().movePanelToLevel(id, target.groupId);
    onClose();
  };

  return createPortal(
    <div className="dialog-overlay group-panel-overlay" onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        if (e.key === 'Tab') {
          const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input');
          if (!nodes?.length) return;
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }}>
      <div ref={dialogRef} className="dialog group-panel-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">{isAdding ? 'Add existing panels' : 'Move panel to group'}</h2>
          <button type="button" className="dialog-close-btn" aria-label="Close picker" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="group-panel-content">
          <p className="group-panel-hint">{isAdding ? `Select panels to move into ${groupName}.` : 'Choose where this panel belongs.'}</p>
          <label className="group-panel-search"><Search size={15} />
            <input aria-label={isAdding ? 'Search panels' : 'Search groups'} placeholder={isAdding ? 'Search panels…' : 'Search groups…'}
              value={query} onChange={e => setQuery(e.target.value)} />
          </label>
          <div className="group-panel-options">
            {visible.map(option => {
              const contents = <>
                {option.isGroup ? <Folder size={18} /> : <LayoutGrid size={18} />}
                <span className="group-panel-option-text"><strong>{option.name}</strong><small>{option.location}</small></span>
              </>;
              return isAdding && option.id !== null ? (
                <label key={option.id} className="group-panel-option">
                  <input type="checkbox" checked={selected.has(option.id)} onChange={e => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(option.id!); else next.delete(option.id!);
                    setSelected(next);
                  }} />{contents}
                </label>
              ) : (
                <button type="button" key={option.id ?? 'main'} className="group-panel-option" onClick={() => {
                  if (target.panelId !== undefined) useGroupStore.getState().movePanelToLevel(target.panelId, option.id);
                  onClose();
                }}>{contents}</button>
              );
            })}
            {visible.length === 0 && <p className="group-panel-empty">
              {options.length > 0 ? 'No matches found.' : isAdding ? 'No other panels are available to add.' : 'No other groups are available.'}
            </p>}
          </div>
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {isAdding && <button type="button" className="btn btn-primary" disabled={selectedIds.length === 0} onClick={addSelected}>
            Add {selectedIds.length > 0 ? selectedIds.length : ''} {selectedIds.length === 1 ? 'panel' : 'panels'}
          </button>}
        </div>
      </div>
    </div>, document.body,
  );
}

export function MovePanelButton({ panelId }: { panelId: string }) {
  useWorkspaceMembership();
  const [open, setOpen] = useState(false);
  if (getGroupMoveOptions(panelId).length === 0) return null;
  return <>
    <button type="button" className="toolbar-btn group-panel-trigger" title="Move to group" aria-label="Move to group"
      aria-haspopup="dialog" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); setOpen(true); }}><FolderInput size={14} /></button>
    {open && <GroupPanelPicker panelId={panelId} onClose={() => setOpen(false)} />}
  </>;
}

export function AddExistingPanelButton({ groupId, compact = false }: { groupId: string; compact?: boolean }) {
  const group = useGroupStore(s => s.groups.get(groupId));
  const [open, setOpen] = useState(false);
  if (!group || group.remotePeerId) return null;
  return <>
    <button type="button" className="group-add-existing" title="Add existing panel" aria-label="Add existing panel" aria-haspopup="dialog"
      onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); setOpen(true); }}><Plus size={13} />{!compact && 'Add existing panel'}</button>
    {open && <GroupPanelPicker groupId={groupId} onClose={() => setOpen(false)} />}
  </>;
}
