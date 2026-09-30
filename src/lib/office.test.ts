import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('window', { localStorage: globalThis.localStorage });
  return values;
});
const { useOfficeGameStore: office } = await import('../store/officeGameStore');
const { ingestOfficeRecords } = await import('../hooks/useWorkerActivity');
const { useLlmChatStore } = await import('../store/llmChatStore');
import { codexSignal, claudeSignal, mapOfficeTool, recordedSignal, rewardForTools } from './officeActivity';
import { workerDestination, blockedCells } from './officeSpace';
import { findPath } from '../engine/PathFinding';
import { WorkerAnimator } from '../engine/WorkerAnimator';
import { emptyCodexState, reduceCodex } from './codexReducer';
import { getDefaultLayout } from '../engine/defaultOffice';
import type { ActivityRecord } from '../types/activity';
import type { OfficeLayout, OfficeWorker } from '../types/office';

const emptyRoom = (): OfficeLayout => ({ width: 8, height: 8, furniture: [], rooms: [], floorTiles: {}, wallTiles: {} });
const record = (id = 'turn'): ActivityRecord => ({ id, kind: 'turn', actor: { id: 'a', name: 'Builder', provider: 'codex', model: null, device: null }, target: null, sessionId: 'thread', startedAt: 100, updatedAt: 200, status: 'completed', prompt: 'Fix the build', response: 'Done', usage: null, parentId: null, usageNote: null, origin: 'user', tools: ['Read', 'Bash', 'Bash', 'Edit'] });
beforeEach(() => { office.setState({ layout: emptyRoom(), workers: {}, profiles: {}, panelAliases: {}, currency: 150, totalEarned: 0, completedTasks: 0, inventory: {}, purchasedItems: [], rewards: [], claimed: {}, startedAt: 50, editMode: false, selectedItem: null, editAction: 'place', movingId: null, rotation: 0 }); });

describe('office work and rewards', () => {
  it('retains the API cancellation marker through the done event and clears it for a new turn', () => {
    const chat = useLlmChatStore.getState();
    chat.addUserMessage('api', 'Task'); chat.startStreaming('api'); chat.markCancelled('api'); chat.finishStreaming('api');
    expect(chat.getConversation('api').cancelled).toBe(true);
    chat.startStreaming('api'); expect(chat.getConversation('api').cancelled).toBe(false);
  });
  it('keeps character progression and late rewards across workspace ID remapping', () => {
    office.getState().addWorker('a', { gridX: 0, gridY: 0 });
    ingestOfficeRecords([record()]);
    office.getState().remapPanels(new Map([['a', 'restored']]));
    office.getState().remapPanels(new Map([['restored', 'restored-again']]));
    ingestOfficeRecords([record('late')]);
    expect(office.getState().profiles['restored-again']).toMatchObject({ appearanceId: 'a', coins: 90, tasks: 2 });
    expect(office.getState().profiles.a).toBeUndefined();
  });
  it('awards completed work once across native replay and store reload', async () => {
    ingestOfficeRecords([record(), record()]);
    expect(office.getState().currency).toBe(195);
    expect(office.getState().completedTasks).toBe(1);
    const saved = storage.get('tessera-office')!;
    office.setState({ claimed: {}, currency: 0 });
    storage.set('tessera-office', saved);
    await office.persist.rehydrate();
    ingestOfficeRecords([record()]);
    expect(office.getState().currency).toBe(195);
    expect(office.getState().profiles.a.tasks).toBe(1);
  });
  it('does not reward old history, pending work, errors, handoffs, or remote work', () => {
    ingestOfficeRecords([{ ...record('old'), startedAt: 0 }, { ...record('run'), status: 'running' }, { ...record('err'), status: 'failed' }, { ...record('handoff'), kind: 'handoff' }, { ...record('remote'), actor: { ...record().actor, device: 'PC' } }]);
    expect(office.getState().currency).toBe(150);
    expect(rewardForTools(['Bash', 'Bash', 'exec_command', 'AskUserQuestion'])).toBe(35);
  });
  it('maps Codex live tools and approval requests to stations', () => {
    let state = { ...emptyCodexState('g'), busy: true, items: [{ id: 'q', type: 'userMessage', content: [{ type: 'text', text: 'Run the test suite' }] }] };
    state = reduceCodex(state, { id: 'a', generation: 'g', sequence: 1, message: { method: 'item/started', params: { item: { id: 'cmd', type: 'commandExecution', command: 'npm test' } } } }) as typeof state;
    expect(codexSignal(state)).toEqual({ activity: 'running_command', task: 'Run the test suite', detail: 'npm test' });
    expect(codexSignal({ ...state, requests: [{ id: 1, method: 'approval', params: {} }] }).activity).toBe('awaiting_permission');
    expect(codexSignal({ ...state, busy: false }).activity).toBe('idle');
    expect(codexSignal({ ...state, connected: false }).activity).toBe('unknown');
    expect(mapOfficeTool('mcp__web__search')).toBe('searching_web');
    expect(mapOfficeTool('apply_patch')).toBe('editing_file');
  });
  it('does not reuse the previous Claude turn tool while a new question starts', () => {
    expect(claudeSignal({ messages: [{ id: 'old', role: 'assistant', isStreaming: false, blocks: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] }, { id: 'new', role: 'user', text: 'New task', timestamp: 1 }], isStreaming: true, error: null, controlRequests: [], result: null }).activity).toBe('thinking');
    expect(recordedSignal({ ...record(), status: 'recorded', currentTool: 'Read' }).activity).toBe('reading_file');
  });
  it('keeps quiet terminal work active until an explicit completion or failure', () => {
    const active = { ...record(), status: 'running', updatedAt: Date.now() - 60 * 60 * 1000, currentTool: 'Bash' };
    expect(recordedSignal(active).activity).toBe('running_command');
    expect(recordedSignal({ ...active, currentTool: null }).activity).toBe('thinking');
    expect(recordedSignal({ ...active, status: 'completed' }).activity).toBe('idle');
    expect(recordedSignal({ ...active, status: 'interrupted' }).activity).toBe('error');
    expect(recordedSignal(undefined).activity).toBe('unknown');
  });
});
describe('office purchases and movement', () => {
  it('charges atomically, consumes placed inventory, and returns packed pieces', () => {
    expect(office.getState().purchase('shop-server')).toBe(false);
    expect(office.getState().purchase('shop-plant-small')).toBe(true);
    expect(office.getState().currency).toBe(120);
    office.getState().selectItem('shop-plant-small');
    expect(office.getState().placeAt({ gridX: 2, gridY: 2 })).toBe(true);
    expect(office.getState().placeAt({ gridX: 3, gridY: 3 })).toBe(false);
    office.setState({ editAction: 'pack' });
    expect(office.getState().placeAt({ gridX: 2, gridY: 2 })).toBe(true);
    expect(office.getState().inventory['shop-plant-small']).toBe(1);
    expect(office.getState().layout.furniture).toHaveLength(0);
  });
  it('rejects overlapping and out-of-bounds placements without consuming inventory', () => {
    office.getState().purchase('shop-desk-oak'); office.getState().selectItem('shop-desk-oak');
    expect(office.getState().placeAt({ gridX: 7, gridY: 7 })).toBe(false);
    expect(office.getState().placeAt({ gridX: 1, gridY: 1 })).toBe(true);
    office.getState().purchase('shop-plant-small'); office.getState().selectItem('shop-plant-small');
    expect(office.getState().placeAt({ gridX: 2, gridY: 1 })).toBe(false);
    expect(office.getState().inventory['shop-plant-small']).toBe(1);
    office.getState().setEditMode(false);
    expect(office.getState().placeAt({ gridX: 5, gridY: 5 })).toBe(false);
  });
  it('unlocks wearable once and blocks equipping unowned items', () => {
    office.getState().equip('a', 'crown'); expect(office.getState().profiles.a).toBeUndefined();
    expect(office.getState().purchase('cap')).toBe(true);
    expect(office.getState().purchase('cap')).toBe(false);
    office.getState().equip('a', 'cap'); expect(office.getState().profiles.a.accessory).toBe('cap');
  });
  it('routes each task to a free room tile and never cuts blocked corners', () => {
    const layout = getDefaultLayout(), blocked = blockedCells(layout);
    for (const activity of ['reading_file', 'running_command', 'idle', 'editing_file', 'awaiting_permission'] as const) {
      const p = workerDestination(layout, activity, 1);
      expect(blocked.has(`${p.gridX},${p.gridY}`)).toBe(false);
      expect(findPath(layout, { gridX: 3, gridY: 3 }, p).length).toBeGreaterThan(0);
    }
    const corner = emptyRoom(); corner.furniture = [{ id: 'x', type: 'plant', rotation: 0, position: { gridX: 1, gridY: 0 } }, { id: 'y', type: 'plant', rotation: 0, position: { gridX: 0, gridY: 1 } }];
    expect(findPath(corner, { gridX: 0, gridY: 0 }, { gridX: 2, gridY: 2 })).toEqual([]);
  });
  it('retargets walking characters from their current position and stays put if unreachable', () => {
    office.getState().addWorker('a', { gridX: 0, gridY: 0 });
    const worker: OfficeWorker = { ...office.getState().workers.a, targetPosition: { gridX: 6, gridY: 0 } };
    const animator = new WorkerAnimator(), layout = emptyRoom();
    animator.assignPath('a', worker, layout);
    const first = animator.update(.6, { a: worker }).get('a')!;
    animator.assignPath('a', { ...worker, targetPosition: { gridX: 6, gridY: 6 } }, layout);
    const second = animator.update(.01, { a: worker }).get('a')!;
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeLessThan(.04);
    layout.furniture.push({ id: 'block', type: 'plant', rotation: 0, position: { gridX: 6, gridY: 6 } });
    animator.assignPath('a', { ...worker, targetPosition: { gridX: 6, gridY: 6 } }, layout);
    expect(animator.update(20, { a: worker }).get('a')).toEqual({ ...second, isWalking: false });
  });
});
