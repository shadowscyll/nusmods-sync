import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RelayPairing } from '../src/shared/types';
import { RELAY_URL } from '../src/shared/constants';
import { bytesToBase64Url } from '../src/sync/encoding';
import {
  createPairingHandoff,
  normalizePairingCode,
  openPairingHandoff,
  pairingCodeId,
  validateStoredPairing,
} from '../src/sync/pairing';
import { createShortPairingCode } from '../src/sync/relay';

const pairing: RelayPairing = {
  version: 1,
  endpoint: RELAY_URL,
  vaultId: bytesToBase64Url(Uint8Array.from({ length: 16 }, (_, index) => index)),
  encryptionKey: bytesToBase64Url(Uint8Array.from({ length: 32 }, (_, index) => index + 16)),
  writeToken: bytesToBase64Url(Uint8Array.from({ length: 16 }, (_, index) => index + 48)),
};

describe('short pairing codes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a four-character one-time code and encrypted handoff', async () => {
    const handoff = await createPairingHandoff(pairing);
    expect(handoff.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/u);
    expect(normalizePairingCode(handoff.code)).toHaveLength(4);
    expect(await openPairingHandoff(handoff.code, handoff.envelope)).toEqual(pairing);
    expect(await pairingCodeId(handoff.code)).toBe(handoff.id);
  });

  it('accepts lowercase, spaces, and unambiguous typo aliases', () => {
    expect(normalizePairingCode('abcd')).toBe('ABCD');
    expect(normalizePairingCode('O1IL')).toBe('0111');
  });

  it('rejects old or malformed codes and invalid stored secrets', () => {
    expect(() => normalizePairingCode('NMS1-old-code')).toThrow(/4 characters/u);
    expect(validateStoredPairing({ ...pairing, encryptionKey: 'short' })).toBeUndefined();
  });

  it('generates a different code if the relay reports a collision', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Pairing code collision' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ expiresAt: 123_456 }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createShortPairingCode(pairing)).resolves.toMatchObject({ expiresAt: 123_456 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
