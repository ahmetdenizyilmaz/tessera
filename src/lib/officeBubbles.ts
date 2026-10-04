import type { BubbleKind, CharacterMood } from '../engine/officeArt';
import type { WorkerActivity } from '../types/office';

const RESTING: WorkerActivity[] = ['idle', 'unknown', 'new'];

/** What floats over a character. Bubbles never show text: a speech bubble with
 * sound waves says "talking to another agent", a thought cloud says "thinking",
 * a gear says "working with tools", a glyph says "needs you". */
export function bubbleFor(activity: WorkerActivity, talking: boolean): BubbleKind {
  if (talking) return 'talk';
  if (activity === 'awaiting_permission') return 'question';
  if (activity === 'error') return 'alert';
  if (RESTING.includes(activity)) return '';
  return activity === 'thinking' ? 'think' : 'work';
}

/** The body animation that goes with the bubble, alternating on `frame`. */
export function moodFor(activity: WorkerActivity, talking: boolean, frame: number): CharacterMood {
  const beat = frame % 2 ? '1' : '0';
  if (talking) return `talk${beat}` as CharacterMood;
  if (activity === 'thinking') return 'think';
  if (RESTING.includes(activity) || activity === 'awaiting_permission' || activity === 'error') return '';
  return `work${beat}` as CharacterMood;
}
