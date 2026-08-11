import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import type { RelayPairing } from '../src/shared/types';
import { RELAY_URL } from '../src/shared/constants';
import { decryptWorkspace, encryptWorkspace } from '../src/sync/crypto';
import { base64UrlToBytes, bytesToBase64Url } from '../src/sync/encoding';
import { workspace } from './fixtures';

const pairing: RelayPairing = {
  version: 1,
  endpoint: RELAY_URL,
  vaultId: 'abcdefghijklmnopqrstuv',
  encryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  writeToken: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('end-to-end encryption', () => {
  it('round-trips a normalized workspace', async () => {
    const base = workspace();
    const original = workspace({
      profiles: [{
        id: 'profile_one',
        name: 'Plan A',
        timetable: base.timetable,
        createdAt: 1,
        updatedAt: 2,
      }],
      activeProfileId: 'profile_one',
    });
    const envelope = await encryptWorkspace(original, pairing);
    expect(envelope.ciphertext).not.toContain('CS2040S');
    await expect(decryptWorkspace(envelope, pairing)).resolves.toEqual(original);
  });

  it('detects ciphertext and metadata tampering', async () => {
    const envelope = await encryptWorkspace(workspace(), pairing);
    await expect(
      decryptWorkspace({ ...envelope, deviceId: 'device_ffffffffffff' }, pairing),
    ).rejects.toThrow();
    const tampered = base64UrlToBytes(envelope.ciphertext);
    tampered[0] ^= 1;
    await expect(
      decryptWorkspace({ ...envelope, ciphertext: bytesToBase64Url(tampered) }, pairing),
    ).rejects.toThrow();
  });
});
