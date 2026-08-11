import type { ConflictDecision, SyncMetadata, SyncedWorkspace } from '../shared/types';
import { workspaceHash, workspacesEqual } from './comparison';

export function classifyRemoteUpdate(
  local: SyncedWorkspace | undefined,
  remote: SyncedWorkspace,
  currentDeviceId: string,
  metadata: SyncMetadata,
): ConflictDecision {
  if (remote.deviceId === currentDeviceId) return { kind: 'ignore', reason: 'same-device' };
  if (
    (remote.revision > 0 && metadata.lastKnownRevision !== undefined && remote.revision <= metadata.lastKnownRevision) ||
    (metadata.lastKnownRevision === undefined && metadata.lastSyncedAt !== undefined && remote.updatedAt <= metadata.lastSyncedAt)
  ) {
    return { kind: 'ignore', reason: 'not-newer' };
  }
  if (local && workspacesEqual(local, remote)) return { kind: 'ignore', reason: 'same-content' };

  const localHasUnpublishedChanges =
    Boolean(local) && metadata.lastPublishedHash !== workspaceHash(local as SyncedWorkspace);
  return localHasUnpublishedChanges ? { kind: 'conflict' } : { kind: 'offer-remote' };
}
