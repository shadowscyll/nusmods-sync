import type { SyncedTimetable, SyncedWorkspace, TimetableData } from '../shared/types';

export function canonicalTimetable(value: TimetableData | SyncedTimetable): TimetableData {
  return {
    schemaVersion: 1,
    academicYear: value.academicYear,
    semester: value.semester,
    modules: value.modules
      .map((module) => ({
        ...module,
        selections: module.selections
          .map((selection) => ({
            ...selection,
            selection:
              selection.selection.kind === 'lessonIds'
                ? { ...selection.selection, lessonIds: [...selection.selection.lessonIds].sort() }
                : { ...selection.selection },
          }))
          .sort((a, b) => a.lessonType.localeCompare(b.lessonType)),
      }))
      .sort((a, b) => a.moduleCode.localeCompare(b.moduleCode)),
  };
}

export function timetableHash(value: TimetableData | SyncedTimetable): string {
  return JSON.stringify(canonicalTimetable(value));
}

export function timetablesEqual(
  left: TimetableData | SyncedTimetable | undefined,
  right: TimetableData | SyncedTimetable | undefined,
): boolean {
  if (!left || !right) return left === right;
  return timetableHash(left) === timetableHash(right);
}

export function isRemoteNewer(local: SyncedTimetable | undefined, remote: SyncedTimetable): boolean {
  return !local || remote.updatedAt > local.updatedAt;
}

export function workspaceHash(value: Pick<SyncedWorkspace, 'timetable' | 'profiles' | 'activeProfileId'>): string {
  return JSON.stringify({
    timetable: canonicalTimetable(value.timetable),
    profiles: value.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      timetable: canonicalTimetable(profile.timetable),
    })),
    activeProfileId: value.activeProfileId,
  });
}

export function workspacesEqual(
  left: Pick<SyncedWorkspace, 'timetable' | 'profiles' | 'activeProfileId'> | undefined,
  right: Pick<SyncedWorkspace, 'timetable' | 'profiles' | 'activeProfileId'> | undefined,
): boolean {
  if (!left || !right) return left === right;
  return workspaceHash(left) === workspaceHash(right);
}
