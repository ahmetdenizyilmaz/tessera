import type { BubbleKind } from '../engine/officeArt';
import type { WorkerActivity } from '../types/office';

/** What floats over a character. Bubbles never show text: the dots say "busy",
 * a tinted bubble says "talking to another agent", a glyph says "needs you". */
export function bubbleFor(activity: WorkerActivity, talking: boolean): BubbleKind {
  if (talking) return 'talk';
  if (activity === 'awaiting_permission') return 'question';
  if (activity === 'error') return 'alert';
  if (['idle', 'unknown', 'new'].includes(activity)) return '';
  return 'dots';
}
