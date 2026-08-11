import {
  LESSON_TYPE_ABBREVIATIONS,
  SEMESTER_PATHS,
} from '../shared/constants';
import { IntegrationError } from '../shared/errors';
import type { SyncedTimetable, TimetableData } from '../shared/types';
import { validateSyncedTimetable } from '../sync/schema';
import { AUTO_IMPORT_HASH, startAutoImport } from './autoImport';

function serializeModule(module: SyncedTimetable['modules'][number]): string {
  return module.selections
    .map(({ lessonType, selection }) => {
      const abbreviation = LESSON_TYPE_ABBREVIATIONS[lessonType];
      if (!abbreviation) throw new IntegrationError(`NUSMods does not recognize lesson type “${lessonType}”`);
      if (selection.kind === 'classNo') return `${abbreviation}:${selection.classNo}`;
      return `${abbreviation}:(${selection.lessonIds.join(',')})`;
    })
    .join(module.isTa ? ';' : ',');
}

export function buildShareUrl(value: SyncedTimetable, origin = 'https://nusmods.com'): string {
  const timetable = validateSyncedTimetable(value);
  const semesterPath = SEMESTER_PATHS[timetable.semester];
  if (!semesterPath) throw new IntegrationError('Unsupported semester');

  const params = new URLSearchParams();
  for (const module of timetable.modules) params.set(module.moduleCode, serializeModule(module));
  const hidden = timetable.modules.filter((module) => module.hidden).map((module) => module.moduleCode);
  const ta = timetable.modules.filter((module) => module.isTa).map((module) => module.moduleCode);
  if (hidden.length > 0) params.set('hidden', hidden.join(','));
  if (ta.length > 0) params.set('ta', ta.join(','));
  return `${origin}/timetable/${semesterPath}/share?${params.toString()}`;
}

export function buildImportUrl(value: SyncedTimetable, origin = 'https://nusmods.com'): string {
  return `${buildShareUrl(value, origin)}${AUTO_IMPORT_HASH}`;
}

export function applyTimetable(timetable: SyncedTimetable, current: TimetableData): void {
  if (timetable.academicYear !== current.academicYear) {
    throw new IntegrationError(
      `Academic year mismatch: this page is ${current.academicYear}, but the snapshot is ${timetable.academicYear}`,
    );
  }
  const url = buildImportUrl(timetable, window.location.origin);
  window.history.pushState(window.history.state, '', url);
  startAutoImport();
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
}
