import { describe, expect, it } from 'vitest';
import { bubbleFor, moodFor } from './officeBubbles';

describe('office bubbles', () => {
  it('shows a distinct bubble for talking, thinking, working and waiting', () => {
    expect(bubbleFor('thinking', true)).toBe('talk');
    expect(bubbleFor('thinking', false)).toBe('think');
    for (const a of ['responding', 'reading_file', 'editing_file', 'running_command', 'searching_web', 'using_tool'] as const) expect(bubbleFor(a, false), a).toBe('work');
    expect(bubbleFor('awaiting_permission', false)).toBe('question');
    expect(bubbleFor('error', false)).toBe('alert');
    for (const a of ['idle', 'new', 'unknown'] as const) expect(bubbleFor(a, false), a).toBe('');
  });
  it('animates the body to match: mouth when talking, gaze when thinking, arms when working', () => {
    expect([moodFor('editing_file', true, 0), moodFor('editing_file', true, 1)]).toEqual(['talk0', 'talk1']);
    expect(moodFor('thinking', false, 5)).toBe('think');
    expect([moodFor('running_command', false, 0), moodFor('running_command', false, 1)]).toEqual(['work0', 'work1']);
    expect(moodFor('idle', false, 1)).toBe('');
    expect(moodFor('awaiting_permission', false, 1)).toBe('');
  });
});
