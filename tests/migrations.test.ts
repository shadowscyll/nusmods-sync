import { describe, expect, it } from 'vitest';

import { migrateTimetable } from '../src/sync/migrations';
import { timetable } from './fixtures';

describe('schema migration boundary', () => {
  it('validates the current schema', () => {
    expect(migrateTimetable(timetable())).toEqual(timetable());
  });

  it('rejects unknown older and future schemas without data loss', () => {
    expect(() => migrateTimetable({ ...timetable(), schemaVersion: 0 })).toThrow('No migration');
    expect(() => migrateTimetable({ ...timetable(), schemaVersion: 2 })).toThrow('No migration');
  });
});
