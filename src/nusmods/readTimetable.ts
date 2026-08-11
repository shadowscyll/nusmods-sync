import { NUSMODS_STORAGE_KEY, PATH_SEMESTERS } from '../shared/constants';
import { IntegrationError } from '../shared/errors';
import { SCHEMA_VERSION, type TimetableData } from '../shared/types';
import { validateTimetableData } from '../sync/schema';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonField(outer: JsonRecord, field: string): unknown {
  const encoded = outer[field];
  if (typeof encoded !== 'string') throw new IntegrationError(`NUSMods ${field} state is missing`);
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    throw new IntegrationError(`NUSMods ${field} state is corrupt`);
  }
}

export function semesterFromPath(pathname: string): number | undefined {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'timetable') return undefined;
  return PATH_SEMESTERS[segments[1] ?? ''];
}

export function parsePersistedTimetable(raw: string, pathname: string): TimetableData {
  let outerValue: unknown;
  try {
    outerValue = JSON.parse(raw) as unknown;
  } catch {
    throw new IntegrationError('NUSMods timetable storage is corrupt');
  }
  if (!isRecord(outerValue)) throw new IntegrationError('Unexpected NUSMods timetable storage');

  const lessons = parseJsonField(outerValue, 'lessons');
  const hidden = parseJsonField(outerValue, 'hidden');
  const ta = parseJsonField(outerValue, 'ta');
  const academicYear = parseJsonField(outerValue, 'academicYear');
  const persist = parseJsonField(outerValue, '_persist');
  if (!isRecord(lessons) || !isRecord(hidden) || !isRecord(ta)) {
    throw new IntegrationError('Unexpected NUSMods timetable maps');
  }
  if (!isRecord(persist) || persist.rehydrated !== true || persist.version !== 2) {
    throw new IntegrationError('Unsupported or not-yet-loaded NUSMods timetable state');
  }
  if (typeof academicYear !== 'string' || academicYear.length === 0) {
    throw new IntegrationError('NUSMods academic year is missing');
  }

  const pathSemester = semesterFromPath(pathname);
  const knownSemesters = Object.keys(lessons).filter((key) => /^[1-4]$/.test(key));
  const semester = pathSemester ?? (knownSemesters.length === 1 ? Number(knownSemesters[0]) : undefined);
  if (!semester) throw new IntegrationError('Open a specific NUSMods semester before syncing');

  const semesterLessons = lessons[String(semester)] ?? {};
  if (!isRecord(semesterLessons)) throw new IntegrationError('Invalid semester timetable');
  const hiddenValue = hidden[String(semester)];
  const taValue = ta[String(semester)];
  const hiddenModules = new Set(
    Array.isArray(hiddenValue)
      ? hiddenValue.filter((item: unknown): item is string => typeof item === 'string')
      : [],
  );
  const taModules = new Set(
    Array.isArray(taValue)
      ? taValue.filter((item: unknown): item is string => typeof item === 'string')
      : [],
  );

  const modules = Object.entries(semesterLessons).map(([rawModuleCode, lessonConfig]) => {
    const moduleCode = rawModuleCode.toUpperCase();
    if (!isRecord(lessonConfig)) throw new IntegrationError(`Invalid ${moduleCode} timetable data`);
    const isTa = taModules.has(rawModuleCode) || taModules.has(moduleCode);
    const selections = Object.entries(lessonConfig).map(([lessonType, identifiers]) => {
      if (!Array.isArray(identifiers) || identifiers.length === 0 || identifiers.some((id) => typeof id !== 'string')) {
        throw new IntegrationError(`Invalid ${moduleCode} ${lessonType} selection`);
      }
      const values = identifiers as string[];
      if (!isTa && (values.length !== 1 || values[0].includes('|'))) {
        throw new IntegrationError(`Unexpected class-number selection for ${moduleCode} ${lessonType}`);
      }
      if (isTa && values.some((value) => !value.includes('|'))) {
        throw new IntegrationError(`Unexpected lesson ID for ${moduleCode} ${lessonType}`);
      }
      return {
        lessonType,
        selection: isTa
          ? ({ kind: 'lessonIds', lessonIds: values } as const)
          : ({ kind: 'classNo', classNo: values[0] } as const),
      };
    });
    return {
      moduleCode,
      hidden: hiddenModules.has(rawModuleCode) || hiddenModules.has(moduleCode),
      isTa,
      selections,
    };
  });

  return validateTimetableData({
    schemaVersion: SCHEMA_VERSION,
    academicYear,
    semester,
    modules,
  });
}

export function readTimetable(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
  pathname: string = window.location.pathname,
): TimetableData {
  if (pathname.split('/').filter(Boolean)[2] === 'share') {
    throw new IntegrationError('Import previews are not treated as local timetable changes');
  }
  const raw = storage.getItem(NUSMODS_STORAGE_KEY);
  if (raw === null) throw new IntegrationError('NUSMods has not persisted a timetable yet');
  return parsePersistedTimetable(raw, pathname);
}
