import type { ClaudeInstance } from '../types/instance';

export interface PanelHibernation {
  /** Accumulated idle time while Tessera runs, never a wall-clock timestamp. */
  idleMs: number;
  sleeping: boolean;
  previewId?: string;
}

export const DEFAULT_HIBERNATION_MINUTES = 60;
export const HIBERNATION_TICK_MS = 15_000;

export function normalizeHibernation(value?: Partial<PanelHibernation>): PanelHibernation {
  return {
    idleMs: Number.isFinite(value?.idleMs) ? Math.max(0, Math.min(value!.idleMs!, 30 * 86400_000)) : 0,
    sleeping: value?.sleeping === true,
    previewId: typeof value?.previewId === 'string' && /^[\da-f-]{36}$/i.test(value.previewId) ? value.previewId : undefined,
  };
}

/** A suspended computer / stalled timer must not count as hours of use. */
export function elapsedAppTime(previous: number, now: number): number {
  const elapsed = now - previous;
  return elapsed >= 0 && elapsed <= HIBERNATION_TICK_MS * 3 ? elapsed : 0;
}

export function supportsHibernation(instance: ClaudeInstance): boolean {
  return !instance.config.llmConfig;
}

export function canAutoHibernate(input: {
  enabledMinutes: number; idleMs: number; focused: boolean; busy: boolean;
  knownIdle: boolean; hasDraft: boolean; starting: boolean; sleeping: boolean;
}): boolean {
  return Number.isFinite(input.enabledMinutes) && input.enabledMinutes > 0
    && input.idleMs >= input.enabledMinutes * 60_000
    && input.knownIdle && !input.busy && !input.focused && !input.hasDraft
    && !input.starting && !input.sleeping;
}
