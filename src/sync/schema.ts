import { IntegrationError } from '../shared/errors';
import { SCHEMA_VERSION, type SyncedTimetable, type SyncedWorkspace, type TimetableData } from '../shared/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new IntegrationError(`Invalid ${field}`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new IntegrationError(`Invalid ${field}`);
  return value;
}

export function validateTimetableData(value: unknown): TimetableData {
  if (!isRecord(value)) throw new IntegrationError('Timetable is not an object');
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new IntegrationError(`Unsupported timetable schema: ${String(value.schemaVersion)}`);
  }
  const academicYear = requireString(value.academicYear, 'academic year');
  if (!Number.isInteger(value.semester) || Number(value.semester) < 1 || Number(value.semester) > 4) {
    throw new IntegrationError('Invalid semester');
  }
  if (!Array.isArray(value.modules)) throw new IntegrationError('Invalid modules');

  const seenModules = new Set<string>();
  const modules = value.modules.map((moduleValue) => {
    if (!isRecord(moduleValue)) throw new IntegrationError('Invalid module');
    const moduleCode = requireString(moduleValue.moduleCode, 'module code').toUpperCase();
    if (!/^[A-Z0-9]+$/.test(moduleCode) || seenModules.has(moduleCode)) {
      throw new IntegrationError(`Invalid or duplicate module code: ${moduleCode}`);
    }
    seenModules.add(moduleCode);
    const hidden = requireBoolean(moduleValue.hidden, `${moduleCode} hidden flag`);
    const isTa = requireBoolean(moduleValue.isTa, `${moduleCode} TA flag`);
    if (!Array.isArray(moduleValue.selections)) {
      throw new IntegrationError(`Invalid selections for ${moduleCode}`);
    }

    const seenLessonTypes = new Set<string>();
    const selections = moduleValue.selections.map((selectionValue) => {
      if (!isRecord(selectionValue) || !isRecord(selectionValue.selection)) {
        throw new IntegrationError(`Invalid selection for ${moduleCode}`);
      }
      const lessonType = requireString(selectionValue.lessonType, 'lesson type');
      if (seenLessonTypes.has(lessonType)) {
        throw new IntegrationError(`Duplicate ${lessonType} selection for ${moduleCode}`);
      }
      seenLessonTypes.add(lessonType);
      const selection = selectionValue.selection;
      if (selection.kind === 'classNo') {
        if (isTa) throw new IntegrationError(`TA module ${moduleCode} contains a class-number selection`);
        return {
          lessonType,
          selection: { kind: 'classNo' as const, classNo: requireString(selection.classNo, 'class number') },
        };
      }
      if (selection.kind === 'lessonIds') {
        if (!isTa || !Array.isArray(selection.lessonIds) || selection.lessonIds.length === 0) {
          throw new IntegrationError(`Invalid lesson IDs for ${moduleCode}`);
        }
        const lessonIds = selection.lessonIds.map((id) => requireString(id, 'lesson ID'));
        if (lessonIds.some((id) => !id.includes('|'))) {
          throw new IntegrationError(`Malformed lesson ID for ${moduleCode}`);
        }
        return { lessonType, selection: { kind: 'lessonIds' as const, lessonIds } };
      }
      throw new IntegrationError(`Unknown selection kind for ${moduleCode}`);
    });

    return { moduleCode, hidden, isTa, selections };
  });

  return { schemaVersion: SCHEMA_VERSION, academicYear, semester: Number(value.semester), modules };
}

export function validateSyncedTimetable(value: unknown): SyncedTimetable {
  const data = validateTimetableData(value);
  const record = value as Record<string, unknown>;
  if (!Number.isFinite(record.updatedAt) || Number(record.updatedAt) <= 0) {
    throw new IntegrationError('Invalid update timestamp');
  }
  const deviceId = requireString(record.deviceId, 'device ID');
  return { ...data, updatedAt: Number(record.updatedAt), deviceId };
}

export function validateSyncedWorkspace(value: unknown): SyncedWorkspace {
  if (!isRecord(value) || value.workspaceVersion !== 1) {
    throw new IntegrationError('Unsupported synced workspace');
  }
  if (!Number.isSafeInteger(value.updatedAt) || Number(value.updatedAt) <= 0) {
    throw new IntegrationError('Invalid workspace timestamp');
  }
  const deviceId = requireString(value.deviceId, 'workspace device ID');
  const revision = value.revision === undefined ? 0 : Number(value.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new IntegrationError('Invalid workspace revision');
  }
  const timetable = validateSyncedTimetable(value.timetable);
  if (!Array.isArray(value.profiles) || value.profiles.length > 10) {
    throw new IntegrationError('Invalid workspace timetables');
  }
  const ids = new Set<string>();
  const profiles = value.profiles.map((item) => {
    if (!isRecord(item)) throw new IntegrationError('Invalid workspace timetable');
    const id = requireString(item.id, 'timetable ID');
    const name = requireString(item.name, 'timetable name');
    if (ids.has(id) || name.length > 40) throw new IntegrationError('Invalid or duplicate timetable');
    ids.add(id);
    if (!Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.updatedAt)) {
      throw new IntegrationError('Invalid timetable timestamp');
    }
    return {
      id,
      name,
      timetable: validateSyncedTimetable(item.timetable),
      createdAt: Number(item.createdAt),
      updatedAt: Number(item.updatedAt),
    };
  });
  const activeProfileId = value.activeProfileId === undefined
    ? undefined
    : requireString(value.activeProfileId, 'active timetable ID');
  if (activeProfileId && !ids.has(activeProfileId)) {
    throw new IntegrationError('Active timetable was not found');
  }
  return {
    workspaceVersion: 1,
    revision,
    updatedAt: Number(value.updatedAt),
    deviceId,
    timetable,
    profiles,
    ...(activeProfileId ? { activeProfileId } : {}),
  };
}
