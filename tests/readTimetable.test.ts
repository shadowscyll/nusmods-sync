import { describe, expect, it } from 'vitest';

import { parsePersistedTimetable, semesterFromPath } from '../src/nusmods/readTimetable';
import { persistedState } from './fixtures';

describe('NUSMods timetable normalization', () => {
  it('maps current semester route names exactly', () => {
    expect(semesterFromPath('/timetable/sem-1')).toBe(1);
    expect(semesterFromPath('/timetable/sem-2')).toBe(2);
    expect(semesterFromPath('/timetable/st-i')).toBe(3);
    expect(semesterFromPath('/timetable/st-ii')).toBe(4);
  });

  it('decodes redux-persist nested JSON and preserves TA lesson IDs', () => {
    const result = parsePersistedTimetable(persistedState(), '/timetable/sem-1');
    expect(result).toEqual({
      schemaVersion: 1,
      academicYear: '2026-2027',
      semester: 1,
      modules: [
        {
          moduleCode: 'CS2040S',
          hidden: true,
          isTa: false,
          selections: [
            { lessonType: 'Lecture', selection: { kind: 'classNo', classNo: '1' } },
            { lessonType: 'Tutorial', selection: { kind: 'classNo', classNo: '03' } },
          ],
        },
        {
          moduleCode: 'CS1010S',
          hidden: false,
          isTa: true,
          selections: [
            {
              lessonType: 'Tutorial',
              selection: { kind: 'lessonIds', lessonIds: ['1|MON|0900|1000|COM1-0203|1_2_3'] },
            },
          ],
        },
      ],
    });
  });

  it('fails closed on an unknown upstream persistence version', () => {
    const outer = JSON.parse(persistedState()) as Record<string, string>;
    outer._persist = JSON.stringify({ version: 3, rehydrated: true });
    expect(() => parsePersistedTimetable(JSON.stringify(outer), '/timetable/sem-1')).toThrow(
      'Unsupported or not-yet-loaded',
    );
  });
});
