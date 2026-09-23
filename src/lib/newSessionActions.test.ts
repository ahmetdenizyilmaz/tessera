import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openNewSessionWizard } from './newSessionActions';
import { captureGroupSnapshot, useGroupStore } from '../store/groupStore';
import { MAX_PANELS, useLayoutStore } from '../store/layoutStore';
import { useWizardStore } from '../store/wizardStore';
import { notify } from './toast';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./forkActions', () => ({ applyForkToInstance: vi.fn() }));
vi.mock('./toast', () => ({ notify: vi.fn() }));
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  } });
});

const layout = () => useLayoutStore.getState();
const groups = () => useGroupStore.getState();
const enter = (id: string) => {
  groups().enterGroup(id);
  groups().commitEnterGroup();
};
const wizardId = () => Object.entries(layout().widgetKinds).find(([, kind]) => kind === 'new-session')![0];

beforeEach(() => {
  vi.clearAllMocks();
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  groups().restoreGroups(new Map());
  useWizardStore.getState().reset();
});

describe('reopening New Session', () => {
  it.each([2, 3, 4, 5, MAX_PANELS])('refocuses and resizes the existing wizard with %i panels, keeping its selections', count => {
    openNewSessionWizard();
    const id = wizardId();
    useWizardStore.getState().set({ panelView: 'terminal', route: 'opencode', cwd: 'C:/chosen-project' });
    const selections = useWizardStore.getState();
    for (let i = 1; i < count; i++) layout().addPanel(`session-${i}`);
    if (count >= 5) {
      useLayoutStore.setState({ layoutConfig: { ...layout().layoutConfig!, mainWidthPercent: 55 } });
      layout().setFocused(`session-${count - 1}`);
    }
    const previousOrder = [...layout().tabOrder];
    expect(layout().focusedId).not.toBe(id);

    openNewSessionWizard();

    expect(layout()).toMatchObject({ focusedId: id, activeTabId: id, tabOrder: previousOrder });
    expect(layout().panelRects.get(id)).toMatchObject({ x: 0, w: count >= 5 ? 55 : 75 });
    if (count >= 5) expect(layout().layoutConfig!.panelOrder[0]).toBe(id);
    expect(useWizardStore.getState()).toBe(selections);
    expect(Object.values(layout().widgetKinds).filter(kind => kind === 'new-session')).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('reveals the wizard when another panel is maximized', () => {
    openNewSessionWizard();
    const id = wizardId();
    layout().addPanel('session');
    layout().toggleMaximized('session');

    openNewSessionWizard();

    expect(layout()).toMatchObject({ focusedId: id, activeTabId: id, maximizedId: id });
  });

  it('returns to an existing root wizard from a group without losing the group panels', () => {
    openNewSessionWizard();
    const id = wizardId();
    const group = groups().createGroup(null);
    layout().addPanel(group, 'group');
    enter(group);
    layout().addPanel('group-session');

    openNewSessionWizard();

    expect(groups().groupStack).toEqual([]);
    expect(layout()).toMatchObject({ focusedId: id, activeTabId: id, tabOrder: [id, group] });
    expect(captureGroupSnapshot().groups.get(group)?.childIds).toEqual(['group-session']);
  });

  it('reveals a wizard inside another nested group and preserves its draft', () => {
    layout().addPanel('root-session');
    const outer = groups().createGroup(null);
    layout().addPanel(outer, 'group');
    enter(outer);
    const nested = groups().createGroup(outer);
    layout().addPanel(nested, 'group');
    enter(nested);
    openNewSessionWizard();
    const id = wizardId();
    useWizardStore.getState().set({ route: 'claude-sub', systemPrompt: 'Keep these instructions.' });
    const draft = useWizardStore.getState();
    groups().jumpToLevel(null);
    groups().clearTransition();
    const sibling = groups().createGroup(null);
    layout().addPanel(sibling, 'group');
    enter(sibling);
    layout().addPanel('sibling-session');

    openNewSessionWizard();

    expect(groups().groupStack).toEqual([outer, nested]);
    expect(layout()).toMatchObject({ focusedId: id, activeTabId: id, tabOrder: [id] });
    expect(useWizardStore.getState()).toBe(draft);
    expect(captureGroupSnapshot().groups.get(sibling)?.childIds).toEqual(['sibling-session']);
    expect(captureGroupSnapshot().rootLayout?.tabOrder).toEqual(['root-session', outer, sibling]);
  });

  it('resets selections only when creating a genuinely new wizard', () => {
    useWizardStore.getState().set({ route: 'opencode', panelView: 'terminal', systemPrompt: 'Old draft' });

    openNewSessionWizard();

    expect(layout().focusedId).toBe(wizardId());
    expect(useWizardStore.getState()).toMatchObject({ route: null, panelView: null, systemPrompt: '' });
  });
});
