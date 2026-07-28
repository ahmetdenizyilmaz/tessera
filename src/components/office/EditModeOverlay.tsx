import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import type { IsometricEngine } from '../../engine/IsometricEngine';
import type { OfficeFurnitureType } from '../../types/office';

interface EditModeOverlayProps {
  engine: IsometricEngine | null;
}

const PLACEABLE_ITEMS: { type: OfficeFurnitureType; label: string }[] = [
  { type: 'desk', label: 'Desk' },
  { type: 'chair', label: 'Chair' },
  { type: 'plant', label: 'Plant' },
  { type: 'bookshelf', label: 'Shelf' },
  { type: 'lamp', label: 'Lamp' },
  { type: 'filing_cabinet', label: 'Cabinet' },
  { type: 'couch', label: 'Couch' },
  { type: 'whiteboard', label: 'Board' },
  { type: 'coffee_machine', label: 'Coffee' },
  { type: 'water_cooler', label: 'Water' },
  { type: 'printer', label: 'Printer' },
  { type: 'poster', label: 'Poster' },
  { type: 'rug', label: 'Rug' },
  { type: 'task_board', label: 'Tasks' },
  { type: 'server_rack', label: 'Server' },
];

export function EditModeOverlay({ engine }: EditModeOverlayProps) {
  const [selectedType, setSelectedType] = useState<OfficeFurnitureType | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const addFurniture = useOfficeGameStore(s => s.addFurniture);
  const removeFurniture = useOfficeGameStore(s => s.removeFurniture);
  const purchasedItems = useOfficeGameStore(s => s.purchasedItems);

  // Listen for tile clicks to place furniture
  if (engine) {
    engine.onTileClick((gx, gy) => {
      if (deleteMode) {
        // Find furniture at this position and remove it
        const layout = useOfficeGameStore.getState().layout;
        const f = layout.furniture.find(
          f => f.position.gridX === gx && f.position.gridY === gy
        );
        if (f) removeFurniture(f.id);
      } else if (selectedType) {
        addFurniture({
          id: `placed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: selectedType,
          position: { gridX: gx, gridY: gy },
          rotation: 0,
        });
      }
    });
  }

  return (
    <div className="edit-overlay">
      <div className="edit-overlay__header">
        <span>Edit Mode</span>
        <button
          className={`edit-overlay__delete-btn ${deleteMode ? 'edit-overlay__delete-btn--active' : ''}`}
          onClick={() => { setDeleteMode(!deleteMode); setSelectedType(null); }}
          title="Delete furniture"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="edit-overlay__palette">
        {PLACEABLE_ITEMS.map(item => (
          <button
            key={item.type}
            className={`edit-overlay__item ${selectedType === item.type ? 'edit-overlay__item--selected' : ''}`}
            onClick={() => { setSelectedType(item.type); setDeleteMode(false); }}
            title={item.label}
          >
            <span className="edit-overlay__item-icon" data-type={item.type} />
            <span className="edit-overlay__item-label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
