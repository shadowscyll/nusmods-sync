import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RelayPairing } from '../src/shared/types';
import { createPushConnection } from '../src/sync/relay';

const pairing: RelayPairing = {
  version: 1,
  endpoint: 'https://sync.example.workers.dev',
  vaultId: 'vault_12345678901234567890',
  encryptionKey: 'key_12345678901234567890123456789012',
  writeToken: 'token_12345678901234567890',
};

afterEach(() => vi.unstubAllGlobals());

describe('instant push connection', () => {
  it('exchanges the write capability for a short-lived WebSocket URL', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      ticket: 'A'.repeat(43),
      expiresAt: 123_456,
    }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const connection = await createPushConnection(pairing, 'device_0123456789ab');

    expect(connection).toEqual({
      url: `wss://sync.example.workers.dev/v1/vaults/${pairing.vaultId}/socket?ticket=${'A'.repeat(43)}`,
      expiresAt: 123_456,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://sync.example.workers.dev/v1/vaults/${pairing.vaultId}/socket-ticket`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${pairing.writeToken}` }),
        body: JSON.stringify({ deviceId: 'device_0123456789ab' }),
      }),
    );
  });

  it('rejects a ticket response without connection metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 201 })));
    await expect(createPushConnection(pairing, 'device_0123456789ab')).rejects.toThrow(/push ticket/u);
  });
});
