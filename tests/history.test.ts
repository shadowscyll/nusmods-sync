import { describe, expect, it } from 'vitest';

import { appendSnapshot, describeDifference } from '../src/sync/history';
import { timetable } from './fixtures';

describe('local history', () => {
  it('deduplicates identical adjacent snapshots', () => {
    const first = appendSnapshot([], timetable(), 'automatic', 100);
    const second = appendSnapshot(first, timetable({ updatedAt: 200 }), 'automatic', 200);
    expect(second).toHaveLength(1);
  });

  it('describes lesson changes', () => {
    const changed = timetable();
    changed.modules[0].selections[1] = {
      lessonType: 'Tutorial',
      selection: { kind: 'classNo', classNo: '07' },
    };
    expect(describeDifference(timetable(), changed)).toBe('CS2040S Tutorial: 03 → 07');
  });

  it('describes added and removed modules', () => {
    expect(describeDifference(timetable(), timetable({ modules: [] }))).toBe('Removed CS2040S');
  });
});
