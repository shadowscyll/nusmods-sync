import type { SyncedTimetable, SyncedWorkspace } from '../src/shared/types';

export function timetable(overrides: Partial<SyncedTimetable> = {}): SyncedTimetable {
  return {
    schemaVersion: 1,
    academicYear: '2026-2027',
    semester: 1,
    modules: [
      {
        moduleCode: 'CS2040S',
        hidden: false,
        isTa: false,
        selections: [
          { lessonType: 'Lecture', selection: { kind: 'classNo', classNo: '1' } },
          { lessonType: 'Tutorial', selection: { kind: 'classNo', classNo: '03' } },
        ],
      },
    ],
    updatedAt: 1_700_000_000_000,
    deviceId: 'device_a8f4c21',
    ...overrides,
  };
}

export function workspace(overrides: Partial<SyncedWorkspace> = {}): SyncedWorkspace {
  const current = timetable();
  return {
    workspaceVersion: 1,
    revision: 1,
    updatedAt: current.updatedAt,
    deviceId: current.deviceId,
    timetable: current,
    profiles: [],
    ...overrides,
  };
}

export function persistedState(): string {
  return JSON.stringify({
    lessons: JSON.stringify({
      1: {
        CS2040S: { Lecture: ['1'], Tutorial: ['03'] },
        CS1010S: {
          Tutorial: ['1|MON|0900|1000|COM1-0203|1_2_3'],
        },
      },
    }),
    hidden: JSON.stringify({ 1: ['CS2040S'] }),
    ta: JSON.stringify({ 1: ['CS1010S'] }),
    academicYear: JSON.stringify('2026-2027'),
    archive: JSON.stringify({}),
    colors: JSON.stringify({}),
    _persist: JSON.stringify({ version: 2, rehydrated: true }),
  });
}
