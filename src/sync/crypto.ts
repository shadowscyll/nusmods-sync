import type { RelayPairing, SyncedWorkspace } from '../shared/types';
import { validateSyncedWorkspace } from './schema';
import { base64UrlToBytes, bytesToBase64Url, decodeUtf8, utf8 } from './encoding';

type LegacyEncryptedWorkspace = {
  envelopeVersion: 1;
  updatedAt: number;
  deviceId: string;
  iv: string;
  ciphertext: string;
};

type RevisionedEncryptedWorkspace = {
  envelopeVersion: 2;
  revision: number;
  updatedAt: number;
  deviceId: string;
  iv: string;
  ciphertext: string;
};

export type EncryptedWorkspace = LegacyEncryptedWorkspace | RevisionedEncryptedWorkspace;

async function importKey(pairing: RelayPairing): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(pairing.encryptionKey), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

function additionalData(
  pairing: RelayPairing,
  revision: number,
  updatedAt: number,
  deviceId: string,
): Uint8Array<ArrayBuffer> {
  return utf8(`nusmods-sync:v2:${pairing.vaultId}:${revision}:${updatedAt}:${deviceId}`);
}

function legacyAdditionalData(pairing: RelayPairing, updatedAt: number, deviceId: string): Uint8Array<ArrayBuffer> {
  return utf8(`nusmods-sync:v1:${pairing.vaultId}:${updatedAt}:${deviceId}`);
}

export async function encryptWorkspace(
  workspace: SyncedWorkspace,
  pairing: RelayPairing,
): Promise<EncryptedWorkspace> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: additionalData(pairing, workspace.revision, workspace.updatedAt, workspace.deviceId),
      tagLength: 128,
    },
    await importKey(pairing),
    utf8(JSON.stringify(workspace)),
  );
  return {
    envelopeVersion: 2,
    revision: workspace.revision,
    updatedAt: workspace.updatedAt,
    deviceId: workspace.deviceId,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptWorkspace(
  envelope: EncryptedWorkspace,
  pairing: RelayPairing,
): Promise<SyncedWorkspace> {
  if (
    (envelope.envelopeVersion !== 1 && envelope.envelopeVersion !== 2) ||
    !Number.isSafeInteger(envelope.updatedAt) ||
    envelope.updatedAt <= 0 ||
    typeof envelope.deviceId !== 'string' ||
    envelope.deviceId.length > 80
  ) throw new Error('Encrypted timetable metadata is invalid');
  if (
    envelope.envelopeVersion === 2 &&
    (!Number.isSafeInteger(envelope.revision) || envelope.revision <= 0)
  ) throw new Error('Encrypted timetable revision is invalid');
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(envelope.iv),
      additionalData: envelope.envelopeVersion === 2
        ? additionalData(pairing, envelope.revision, envelope.updatedAt, envelope.deviceId)
        : legacyAdditionalData(pairing, envelope.updatedAt, envelope.deviceId),
      tagLength: 128,
    },
    await importKey(pairing),
    base64UrlToBytes(envelope.ciphertext),
  );
  const workspace = validateSyncedWorkspace(JSON.parse(decodeUtf8(new Uint8Array(plaintext))));
  if (
    workspace.revision !== (envelope.envelopeVersion === 2 ? envelope.revision : 0) ||
    workspace.updatedAt !== envelope.updatedAt ||
    workspace.deviceId !== envelope.deviceId
  ) {
    throw new Error('Encrypted workspace metadata does not match its payload');
  }
  return workspace;
}
