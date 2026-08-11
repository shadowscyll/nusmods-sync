import { RELAY_URL } from '../shared/constants';
import type { FriendShareAccess, OwnedFriendShare, SyncedTimetable } from '../shared/types';
import { base64UrlToBytes, bytesToBase64Url, decodeUtf8, randomBase64Url, utf8 } from './encoding';
import { validateSyncedTimetable } from './schema';

export type FriendEnvelope = {
  envelopeVersion: 1;
  updatedAt: number;
  deviceId: string;
  iv: string;
  ciphertext: string;
};

function configuredEndpoint(): string {
  return RELAY_URL.replace(/\/$/u, '');
}

function additionalData(access: FriendShareAccess, updatedAt: number, deviceId: string): Uint8Array<ArrayBuffer> {
  return utf8(`nusmods-sync:friend:v1:${access.shareId}:${updatedAt}:${deviceId}`);
}

async function key(access: FriendShareAccess): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(access.encryptionKey), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function createOwnedFriendShare(name: string, profileId?: string): OwnedFriendShare {
  const id = crypto.randomUUID();
  const readToken = randomBase64Url(16);
  return {
    id,
    name: name.trim().slice(0, 40) || 'My timetable',
    ...(profileId ? { profileId } : {}),
    access: {
      version: 1,
      endpoint: configuredEndpoint(),
      shareId: readToken,
      encryptionKey: randomBase64Url(32),
      readToken,
    },
    writeToken: randomBase64Url(16),
    createdAt: Date.now(),
  };
}

export function encodeFriendLink(access: FriendShareAccess): string {
  const compact = access.shareId === access.readToken
    ? `${access.readToken}.${access.encryptionKey}`
    : `${access.shareId}.${access.readToken}.${access.encryptionKey}`;
  return `https://nusmods.com/timetable/sem-1#nmsf=${compact}`;
}

export function decodeFriendLink(link: string): FriendShareAccess {
  const trimmed = link.trim();
  let payload = trimmed;
  try {
    const url = new URL(trimmed);
    const hash = new URLSearchParams(url.hash.slice(1));
    payload = hash.get('nmsf') ?? hash.get('nusmods-sync-friend') ?? '';
  } catch {
    payload = trimmed.replace(/^(?:nmsf|nusmods-sync-friend)=/u, '');
  }
  try {
    const parts = payload.split('.');
    const compactValue = parts.length === 2
      ? { version: 1 as const, endpoint: configuredEndpoint(), shareId: parts[0], readToken: parts[0], encryptionKey: parts[1] }
      : parts.length === 3
        ? { version: 1 as const, endpoint: configuredEndpoint(), shareId: parts[0], readToken: parts[1], encryptionKey: parts[2] }
        : undefined;
    const value = compactValue ?? JSON.parse(decodeUtf8(base64UrlToBytes(payload))) as Partial<FriendShareAccess>;
    if (
      value.version !== 1 || value.endpoint !== configuredEndpoint() ||
      typeof value.shareId !== 'string' || base64UrlToBytes(value.shareId).length !== 16 ||
      typeof value.encryptionKey !== 'string' || base64UrlToBytes(value.encryptionKey).length !== 32 ||
      typeof value.readToken !== 'string' || ![16, 32].includes(base64UrlToBytes(value.readToken).length)
    ) throw new Error();
    return value as FriendShareAccess;
  } catch {
    throw new Error('Friend link is invalid');
  }
}

export async function encryptFriendTimetable(
  timetable: SyncedTimetable,
  access: FriendShareAccess,
): Promise<FriendEnvelope> {
  const validated = validateSyncedTimetable(timetable);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(access, validated.updatedAt, validated.deviceId), tagLength: 128 },
    await key(access),
    utf8(JSON.stringify(validated)),
  );
  return {
    envelopeVersion: 1,
    updatedAt: validated.updatedAt,
    deviceId: validated.deviceId,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptFriendTimetable(
  envelope: FriendEnvelope,
  access: FriendShareAccess,
): Promise<SyncedTimetable> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(envelope.iv),
        additionalData: additionalData(access, envelope.updatedAt, envelope.deviceId),
        tagLength: 128,
      },
      await key(access),
      base64UrlToBytes(envelope.ciphertext),
    );
    const timetable = validateSyncedTimetable(JSON.parse(decodeUtf8(new Uint8Array(plaintext))));
    if (timetable.updatedAt !== envelope.updatedAt || timetable.deviceId !== envelope.deviceId) throw new Error();
    return timetable;
  } catch {
    throw new Error('Friend timetable could not be decrypted');
  }
}
