import { usePanelShortcutStore } from '../../store/panelShortcutStore';
import { useLayoutStore } from '../../store/layoutStore';

export function PanelShortcutBadge({ panelId }: { panelId: string }) {
  const altHeld = usePanelShortcutStore(state => state.altHeld);
  const number = usePanelShortcutStore(state => state.ctrlHeld || state.altHeld
    ? Object.keys(state.bindings).find(slot => state.bindings[slot] === panelId) : undefined);
  // Match Alt+number's assignment target, including its active-tab fallback.
  const canAssign = useLayoutStore(state => (state.focusedId ?? state.activeTabId) === panelId
    && state.tabOrder.includes(panelId));
  if (number === undefined && (!altHeld || !canAssign)) return null;
  const label = `Ctrl + ${number ?? '?'}`;
  return <kbd className={`panel-shortcut-badge${altHeld ? ' panel-shortcut-badge--assign' : ''}`}
    aria-label={number === undefined ? 'Unassigned panel shortcut' : `Panel shortcut ${label}`}
    title={altHeld ? 'Focus this panel and press Alt + a number to assign its shortcut'
      : `${label} focuses this panel`}>{label}</kbd>;
}
