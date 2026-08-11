import { HISTORY_LIMIT } from '../shared/constants';
import type { HistorySnapshot, HistorySource, SyncedTimetable } from '../shared/types';
import { timetableHash } from './comparison';
import { getHistory, setHistory } from './storage';

type SelectionMap = Map<string, string>;

function flattenSelections(timetable: SyncedTimetable): SelectionMap {
  const result = new Map<string, string>();
  for (const module of timetable.modules) {
    for (const lesson of module.selections) {
      const value =
        lesson.selection.kind === 'classNo'
          ? lesson.selection.classNo
          : lesson.selection.lessonIds.join(' + ');
      result.set(`${module.moduleCode}\u0000${lesson.lessonType}`, value);
    }
  }
  return result;
}

export function describeDifference(
  previous: SyncedTimetable | undefined,
  current: SyncedTimetable,
): string {
  if (!previous) return `Saved ${current.modules.length} module${current.modules.length === 1 ? '' : 's'}`;
  const previousModules = new Set(previous.modules.map((module) => module.moduleCode));
  const currentModules = new Set(current.modules.map((module) => module.moduleCode));
  const changes: string[] = [];
  for (const code of currentModules) if (!previousModules.has(code)) changes.push(`Added ${code}`);
  for (const code of previousModules) if (!currentModules.has(code)) changes.push(`Removed ${code}`);

  const before = flattenSelections(previous);
  const after = flattenSelections(current);
  for (const [key, nextValue] of after) {
    const previousValue = before.get(key);
    if (previousValue !== undefined && previousValue !== nextValue) {
      const [moduleCode, lessonType] = key.split('\u0000');
      changes.push(`${moduleCode} ${lessonType}: ${previousValue} → ${nextValue}`);
    }
  }
  if (changes.length === 0 && previous.semester !== current.semester) {
    changes.push(`Changed to Semester ${current.semester}`);
  }
  if (changes.length === 0) changes.push('Updated timetable');
  return changes.length > 1 ? `${changes[0]} and ${changes.length - 1} more` : changes[0];
}

export function appendSnapshot(
  history: HistorySnapshot[],
  timetable: SyncedTimetable,
  source: HistorySource,
  now = Date.now(),
): HistorySnapshot[] {
  if (history[0] && timetableHash(history[0].timetable) === timetableHash(timetable)) return history;
  const snapshot: HistorySnapshot = {
    id: `${now}_${timetable.deviceId}`,
    timetable,
    savedAt: now,
    source,
    summary: describeDifference(history[0]?.timetable, timetable),
  };
  return [snapshot, ...history].slice(0, HISTORY_LIMIT);
}

export async function saveSnapshot(
  timetable: SyncedTimetable,
  source: HistorySource,
): Promise<HistorySnapshot[]> {
  const next = appendSnapshot(await getHistory(), timetable, source);
  await setHistory(next);
  return next;
}
