import { DEFAULT_SETTINGS, LOCAL_KEYS } from '../shared/constants';
import type {
  ExtensionSettings,
  HistorySnapshot,
  SyncMetadata,
  SyncedTimetable,
  SyncedWorkspace,
  RelayPairing,
  TimetableProfile,
  CachedPairingCode,
  FriendShareAccess,
  FriendTimetable,
  OwnedFriendShare,
} from '../shared/types';
import { migrateTimetable } from './migrations';
import { validateSyncedWorkspace } from './schema';
import { validateStoredPairing } from './pairing';
import { webext } from '../shared/webext';

async function localGet<T>(key: string): Promise<T | undefined> {
  const result = await webext.storage.local.get(key);
  return result[key] as T | undefined;
}

export async function getDeviceId(): Promise<string> {
  const existing = await localGet<unknown>(LOCAL_KEYS.deviceId);
  if (typeof existing === 'string' && existing.startsWith('device_')) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const deviceId = `device_${suffix}`;
  await webext.storage.local.set({ [LOCAL_KEYS.deviceId]: deviceId });
  return deviceId;
}

export async function getLocalCurrent(): Promise<SyncedTimetable | undefined> {
  const value = await localGet<unknown>(LOCAL_KEYS.current);
  if (value === undefined) return undefined;
  try {
    return migrateTimetable(value);
  } catch {
    return undefined;
  }
}

export async function setLocalCurrent(timetable: SyncedTimetable): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.current]: timetable });
}

export async function getRelayPairing(): Promise<RelayPairing | undefined> {
  return validateStoredPairing(await localGet<unknown>(LOCAL_KEYS.relayPairing));
}

export async function setRelayPairing(pairing: RelayPairing): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.relayPairing]: pairing });
}

export async function clearRelayPairing(): Promise<void> {
  await webext.storage.local.remove(LOCAL_KEYS.relayPairing);
}

export async function getCachedPairingCode(): Promise<CachedPairingCode | undefined> {
  const value = await localGet<Partial<CachedPairingCode>>(LOCAL_KEYS.pairingCode);
  if (typeof value?.code !== 'string' || typeof value.expiresAt !== 'number') return undefined;
  return { code: value.code, expiresAt: value.expiresAt };
}

export async function setCachedPairingCode(value: CachedPairingCode): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.pairingCode]: value });
}

export async function clearCachedPairingCode(): Promise<void> {
  await webext.storage.local.remove(LOCAL_KEYS.pairingCode);
}

export async function getPendingRemote(): Promise<SyncedWorkspace | undefined> {
  const value = await localGet<unknown>(LOCAL_KEYS.pendingRemote);
  if (value === undefined) return undefined;
  try {
    return validateSyncedWorkspace(value);
  } catch {
    await clearPendingRemote();
    return undefined;
  }
}

export async function setPendingRemote(workspace: SyncedWorkspace): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.pendingRemote]: workspace });
}

export async function clearPendingRemote(): Promise<void> {
  await webext.storage.local.remove(LOCAL_KEYS.pendingRemote);
}

export type RemoteVersion = Pick<SyncedWorkspace, 'deviceId' | 'updatedAt'>;

export async function getIgnoredRemote(): Promise<RemoteVersion | undefined> {
  const value = await localGet<unknown>(LOCAL_KEYS.ignoredRemote);
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<RemoteVersion>;
  if (typeof candidate.deviceId !== 'string' || typeof candidate.updatedAt !== 'number') return undefined;
  return { deviceId: candidate.deviceId, updatedAt: candidate.updatedAt };
}

export async function setIgnoredRemote(remote: RemoteVersion): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.ignoredRemote]: remote });
}

export async function clearIgnoredRemote(): Promise<void> {
  await webext.storage.local.remove(LOCAL_KEYS.ignoredRemote);
}

export async function getMetadata(): Promise<SyncMetadata> {
  const value = await localGet<Partial<SyncMetadata>>(LOCAL_KEYS.metadata);
  return {
    status: value?.status ?? 'idle',
    lastPublishedHash: value?.lastPublishedHash,
    lastSyncedAt: value?.lastSyncedAt,
    error: value?.error,
    payloadVersion: value?.payloadVersion === 1 ? 1 : undefined,
    lastKnownRevision: Number.isSafeInteger(value?.lastKnownRevision) && Number(value?.lastKnownRevision) >= 0
      ? Number(value?.lastKnownRevision)
      : undefined,
    lastPublishedRevision: Number.isSafeInteger(value?.lastPublishedRevision) && Number(value?.lastPublishedRevision) > 0
      ? Number(value?.lastPublishedRevision)
      : undefined,
    revisionAcks: value?.revisionAcks && typeof value.revisionAcks === 'object'
      ? Object.fromEntries(Object.entries(value.revisionAcks).filter(
        ([deviceId, revision]) => deviceId.startsWith('device_') && Number.isSafeInteger(revision) && revision > 0,
      ))
      : undefined,
  };
}

export async function setMetadata(metadata: SyncMetadata): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.metadata]: metadata });
}

export async function patchMetadata(patch: Partial<SyncMetadata>): Promise<SyncMetadata> {
  const next = { ...(await getMetadata()), ...patch };
  if (patch.error === undefined && patch.status !== 'error') delete next.error;
  await setMetadata(next);
  return next;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const value = await localGet<Partial<ExtensionSettings>>(LOCAL_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...value };
}

export async function setSettings(settings: ExtensionSettings): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.settings]: settings });
}

export async function getHistory(): Promise<HistorySnapshot[]> {
  const value = await localGet<unknown>(LOCAL_KEYS.history);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HistorySnapshot => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as Partial<HistorySnapshot>;
    return typeof candidate.id === 'string' && typeof candidate.savedAt === 'number' && Boolean(candidate.timetable);
  });
}

export async function setHistory(history: HistorySnapshot[]): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.history]: history });
}

export async function getProfiles(): Promise<TimetableProfile[]> {
  const value = await localGet<unknown>(LOCAL_KEYS.profiles);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TimetableProfile[] => {
    if (typeof item !== 'object' || item === null) return [];
    const profile = item as Partial<TimetableProfile>;
    if (
      typeof profile.id !== 'string' ||
      typeof profile.name !== 'string' ||
      typeof profile.createdAt !== 'number' ||
      typeof profile.updatedAt !== 'number'
    ) return [];
    try {
      return [{
        id: profile.id,
        name: profile.name,
        timetable: migrateTimetable(profile.timetable),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      }];
    } catch {
      return [];
    }
  });
}

export async function setProfiles(profiles: TimetableProfile[]): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.profiles]: profiles });
}

export async function getActiveProfileId(): Promise<string | undefined> {
  const value = await localGet<unknown>(LOCAL_KEYS.activeProfileId);
  return typeof value === 'string' ? value : undefined;
}

export async function setActiveProfileId(profileId: string | undefined): Promise<void> {
  if (profileId) await webext.storage.local.set({ [LOCAL_KEYS.activeProfileId]: profileId });
  else await webext.storage.local.remove(LOCAL_KEYS.activeProfileId);
}

function validShareAccess(value: unknown): value is FriendShareAccess {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<FriendShareAccess>;
  return item.version === 1 && typeof item.endpoint === 'string' && typeof item.shareId === 'string' &&
    typeof item.encryptionKey === 'string' && typeof item.readToken === 'string';
}

export async function getOwnedFriendShares(): Promise<OwnedFriendShare[]> {
  const value = await localGet<unknown>(LOCAL_KEYS.ownedFriendShares);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is OwnedFriendShare => {
    if (typeof item !== 'object' || item === null) return false;
    const share = item as Partial<OwnedFriendShare>;
    return typeof share.id === 'string' && typeof share.name === 'string' &&
      typeof share.writeToken === 'string' && typeof share.createdAt === 'number' && validShareAccess(share.access);
  });
}

export async function setOwnedFriendShares(shares: OwnedFriendShare[]): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.ownedFriendShares]: shares });
}

export async function getFriends(): Promise<FriendTimetable[]> {
  const value = await localGet<unknown>(LOCAL_KEYS.friends);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): FriendTimetable[] => {
    if (typeof item !== 'object' || item === null) return [];
    const friend = item as Partial<FriendTimetable>;
    if (typeof friend.id !== 'string' || typeof friend.name !== 'string' || !validShareAccess(friend.access)) return [];
    let timetable: SyncedTimetable | undefined;
    try { timetable = friend.timetable ? migrateTimetable(friend.timetable) : undefined; } catch { return []; }
    return [{
      id: friend.id,
      name: friend.name,
      access: friend.access,
      ...(timetable ? { timetable } : {}),
      ...(typeof friend.updatedAt === 'number' ? { updatedAt: friend.updatedAt } : {}),
      enabled: friend.enabled !== false,
    }];
  });
}

export async function setFriends(friends: FriendTimetable[]): Promise<void> {
  await webext.storage.local.set({ [LOCAL_KEYS.friends]: friends });
}

export async function getActiveFriendId(): Promise<string | undefined> {
  const value = await localGet<unknown>(LOCAL_KEYS.activeFriendId);
  return typeof value === 'string' ? value : undefined;
}

export async function setActiveFriendId(friendId: string | undefined): Promise<void> {
  if (friendId) await webext.storage.local.set({ [LOCAL_KEYS.activeFriendId]: friendId });
  else await webext.storage.local.remove(LOCAL_KEYS.activeFriendId);
}
