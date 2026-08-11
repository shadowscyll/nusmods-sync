import { IntegrationError } from '../shared/errors';
import type { SyncedTimetable } from '../shared/types';
import { validateSyncedTimetable } from './schema';

export function migrateTimetable(value: unknown): SyncedTimetable {
  if (typeof value !== 'object' || value === null) {
    throw new IntegrationError('Synced timetable is corrupt');
  }
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version === 1) return validateSyncedTimetable(value);
  throw new IntegrationError(`No migration is available for schema ${String(version)}`);
}
