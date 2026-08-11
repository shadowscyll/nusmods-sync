import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RelayPairing } from '../src/shared/types';
import { acknowledgeWorkspaceRevision, uploadWorkspace } from '../src/sync/relay';
import { validateSyncedWorkspace } from '../src/sync/schema';
import { workspace } from './fixtures';

const pairing: RelayPairing = {
  version: 1,
  endpoint: 'https://sync.example.workers.dev',
  vaultId: 'abcdefghijklmnopqrstuv',
  encryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  writeToken: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

describe('revision acknowledgements', () => {
  it('reads a pre-revision encrypted workspace as revision zero for an in-place upgrade', () => {
    const { revision: _revision, ...legacy } = workspace();
    expect(validateSyncedWorkspace(legacy).revision).toBe(0);
  });

  it('uploads an authenticated revision and verifies the relay acknowledgement', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ stored: true, revision: 7 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadWorkspace(pairing, workspace({ revision: 7 }))).resolves.toEqual({
      status: 'stored',
      revision: 7,
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { envelope: { envelopeVersion: number; revision: number } };
    expect(body.envelope).toMatchObject({ envelopeVersion: 2, revision: 7 });
  });

  it('reports a stale base revision without treating it as a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ revision: 8 }, { status: 409 })));
    await expect(uploadWorkspace(pairing, workspace({ revision: 7 }))).resolves.toEqual({ status: 'stale' });
  });

  it('acknowledges only after a device has applied a revision', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ acknowledged: true, revision: 7 }));
    vi.stubGlobal('fetch', fetchMock);

    await acknowledgeWorkspaceRevision(pairing, 'device_0123456789ab', 7);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://sync.example.workers.dev/v1/vaults/${pairing.vaultId}/ack`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deviceId: 'device_0123456789ab', revision: 7 }),
      }),
    );
  });
});
