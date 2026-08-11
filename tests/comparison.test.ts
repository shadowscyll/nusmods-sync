import { describe, expect, it } from 'vitest';

import { canonicalTimetable, isRemoteNewer, timetablesEqual } from '../src/sync/comparison';
import { timetable } from './fixtures';

describe('timetable comparison', () => {
  it('ignores metadata and input ordering', () => {
    const left = timetable();
    const right = timetable({
      updatedAt: left.updatedAt + 100,
      deviceId: 'device_other',
      modules: left.modules.map((module) => ({ ...module, selections: [...module.selections].reverse() })),
    });
    expect(timetablesEqual(left, right)).toBe(true);
    expect(canonicalTimetable(right).modules[0].selections[0].lessonType).toBe('Lecture');
  });

  it('detects a class change', () => {
    const changed = timetable();
    changed.modules[0].selections[1] = {
      lessonType: 'Tutorial',
      selection: { kind: 'classNo', classNo: '07' },
    };
    expect(timetablesEqual(timetable(), changed)).toBe(false);
  });

  it('detects a custom lesson-slot change without adding or removing a module', () => {
    const changed = timetable();
    changed.modules[0].selections[0] = {
      lessonType: 'Lecture',
      selection: { kind: 'lessonIds', lessonIds: ['MON|1000|1200|LT17|1_2_3'] },
    };
    expect(timetablesEqual(timetable(), changed)).toBe(false);
  });

  it('compares timestamps strictly', () => {
    const local = timetable({ updatedAt: 200 });
    expect(isRemoteNewer(local, timetable({ updatedAt: 201 }))).toBe(true);
    expect(isRemoteNewer(local, timetable({ updatedAt: 200 }))).toBe(false);
    expect(isRemoteNewer(local, timetable({ updatedAt: 199 }))).toBe(false);
  });
});
