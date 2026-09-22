import { beforeEach, expect, it, vi } from 'vitest';
import { PanelShortcutBadge } from './PanelShortcutBadge';

const { shortcuts, layout } = vi.hoisted(() => ({
  shortcuts: { bindings: {} as Record<string, string>, ctrlHeld: false, altHeld: false },
  layout: { focusedId: 'first' as string | null, activeTabId: 'first' as string | null,
    tabOrder: ['first', 'second'] },
}));
vi.mock('../../store/panelShortcutStore', () => ({ usePanelShortcutStore: (select: (state: typeof shortcuts) => unknown) => select(shortcuts) }));
vi.mock('../../store/layoutStore', () => ({ useLayoutStore: (select: (state: typeof layout) => unknown) => select(layout) }));

beforeEach(() => {
  Object.assign(shortcuts, { bindings: {}, ctrlHeld: false, altHeld: false });
  Object.assign(layout, { focusedId: 'first', activeTabId: 'first', tabOrder: ['first', 'second'] });
});

it('hides assigned and unassigned badges when neither modifier is held', () => {
  shortcuts.bindings = { 1: 'first' };
  expect(PanelShortcutBadge({ panelId: 'first' })).toBeNull();
  expect(PanelShortcutBadge({ panelId: 'second' })).toBeNull();
});

it('shows assigned numbers with Ctrl even when the panel is unfocused', () => {
  shortcuts.ctrlHeld = true;
  shortcuts.bindings = { 0: 'second' };
  const badge = PanelShortcutBadge({ panelId: 'second' });
  expect(badge?.props.children).toBe('Ctrl + 0');
  expect(badge?.props.className).not.toContain('--assign');
});

it('never shows an unassigned placeholder with Ctrl alone', () => {
  shortcuts.ctrlHeld = true;
  expect(PanelShortcutBadge({ panelId: 'first' })).toBeNull();
});

it('shows a red placeholder only on the focused unassigned panel with Alt', () => {
  shortcuts.altHeld = true;
  const badge = PanelShortcutBadge({ panelId: 'first' });
  expect(badge?.props.children).toBe('Ctrl + ?');
  expect(badge?.props.className).toContain('--assign');
  expect(PanelShortcutBadge({ panelId: 'second' })).toBeNull();
});

it('keeps assigned unfocused panels visible in red with Alt', () => {
  shortcuts.altHeld = true;
  shortcuts.bindings = { 3: 'second' };
  const badge = PanelShortcutBadge({ panelId: 'second' });
  expect(badge?.props.children).toBe('Ctrl + 3');
  expect(badge?.props.className).toContain('--assign');
});

it('matches the assignment handler active-tab fallback and ignores closed targets', () => {
  shortcuts.altHeld = true;
  layout.focusedId = null;
  layout.activeTabId = 'second';
  expect(PanelShortcutBadge({ panelId: 'first' })).toBeNull();
  expect(PanelShortcutBadge({ panelId: 'second' })?.props.children).toBe('Ctrl + ?');
  layout.tabOrder = ['first'];
  expect(PanelShortcutBadge({ panelId: 'second' })).toBeNull();
});
