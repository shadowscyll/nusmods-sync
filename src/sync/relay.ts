import type { FriendPushConnection, FriendShareAccess, OwnedFriendShare, PushConnection, RelayPairing, SyncedTimetable, SyncedWorkspace } from '../shared/types';
import { decryptWorkspace, encryptWorkspace, type EncryptedWorkspace } from './crypto';
import { utf8, bytesToBase64Url } from './encoding';
import {
  createPairingHandoff,
  openPairingHandoff,
  pairingCodeId,
  type PairingHandoffEnvelope,
} from './pairing';
import { decryptFriendTimetable, encryptFriendTimetable, type FriendEnvelope } from './friends';

type RelayResponse = {
  envelope?: EncryptedWorkspace;
  error?: string;
};

async function tokenHash(token: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(token))));
}

async function request(
  pairing: RelayPairing,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${pairing.endpoint}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${pairing.writeToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (response.ok || response.status === 404 || response.status === 409) return response;
  let message = `Relay request failed (${response.status})`;
  try {
    const body = (await response.json()) as RelayResponse;
    if (body.error) message = body.error;
  } catch {
    // Keep the safe status-only error.
  }
  throw new Error(message);
}

export async function registerVault(pairing: RelayPairing): Promise<void> {
  const response = await fetch(`${pairing.endpoint}/v1/vaults`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ vaultId: pairing.vaultId, tokenHash: await tokenHash(pairing.writeToken) }),
  });
  if (!response.ok) throw new Error(`Could not set up sync (${response.status})`);
}

export async function uploadWorkspace(
  pairing: RelayPairing,
  workspace: SyncedWorkspace,
): Promise<{ status: 'stored'; revision: number } | { status: 'stale' }> {
  const envelope = await encryptWorkspace(workspace, pairing);
  const response = await request(pairing, `/v1/vaults/${encodeURIComponent(pairing.vaultId)}`, {
    method: 'PUT',
    body: JSON.stringify({ envelope }),
  });
  if (response.status === 409) return { status: 'stale' };
  const body = (await response.json()) as { revision?: unknown };
  if (body.revision !== workspace.revision) throw new Error('Relay acknowledged the wrong revision');
  return { status: 'stored', revision: workspace.revision };
}

export async function acknowledgeWorkspaceRevision(
  pairing: RelayPairing,
  deviceId: string,
  revision: number,
): Promise<void> {
  const response = await request(pairing, `/v1/vaults/${encodeURIComponent(pairing.vaultId)}/ack`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, revision }),
  });
  if (!response.ok) throw new Error('Could not acknowledge the applied timetable');
}

export async function downloadWorkspace(pairing: RelayPairing): Promise<SyncedWorkspace | undefined> {
  const response = await request(pairing, `/v1/vaults/${encodeURIComponent(pairing.vaultId)}`);
  if (response.status === 404) throw new Error('Sync connection was not found or has expired');
  if (response.status === 204) return undefined;
  const body = (await response.json()) as RelayResponse;
  if (!body.envelope) throw new Error('Relay response is missing its encrypted payload');
  return decryptWorkspace(body.envelope, pairing);
}

export async function createPushConnection(
  pairing: RelayPairing,
  deviceId: string,
): Promise<PushConnection> {
  const path = `/v1/vaults/${encodeURIComponent(pairing.vaultId)}/socket-ticket`;
  const response = await request(pairing, path, {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
  const body = (await response.json()) as { ticket?: unknown; expiresAt?: unknown };
  if (typeof body.ticket !== 'string' || typeof body.expiresAt !== 'number') {
    throw new Error('Relay response is missing its push ticket');
  }
  const url = new URL(`${pairing.endpoint}/v1/vaults/${encodeURIComponent(pairing.vaultId)}/socket`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', body.ticket);
  return { url: url.toString(), expiresAt: body.expiresAt };
}

export async function createShortPairingCode(pairing: RelayPairing): Promise<{ code: string; expiresAt: number }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const handoff = await createPairingHandoff(pairing);
    const response = await fetch(`${pairing.endpoint}/v1/pairings/${handoff.id}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope: handoff.envelope }),
    });
    if (response.status === 409) continue;
    if (!response.ok) throw new Error(`Could not create pairing code (${response.status})`);
    const body = (await response.json()) as { expiresAt?: unknown };
    if (typeof body.expiresAt !== 'number') throw new Error('Pairing code expiry is missing');
    return { code: handoff.code, expiresAt: body.expiresAt };
  }
  throw new Error('Could not create a unique pairing code. Try again.');
}

export async function redeemShortPairingCode(code: string): Promise<RelayPairing> {
  const id = await pairingCodeId(code);
  const response = await fetch(`${__RELAY_URL__.replace(/\/$/u, '')}/v1/pairings/${id}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'Pairing code is invalid or expired' : `Could not use pairing code (${response.status})`);
  const body = (await response.json()) as { envelope?: PairingHandoffEnvelope };
  if (!body.envelope) throw new Error('Pairing code payload is missing');
  return openPairingHandoff(code, body.envelope);
}

async function shareRequest(access: FriendShareAccess, path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${access.endpoint}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (response.ok || response.status === 204 || response.status === 404 || response.status === 409) return response;
  throw new Error(`Friend sharing failed (${response.status})`);
}

export async function registerFriendShare(share: OwnedFriendShare): Promise<void> {
  const response = await fetch(`${share.access.endpoint}/v1/shares`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shareId: share.access.shareId,
      readTokenHash: await tokenHash(share.access.readToken),
      writeTokenHash: await tokenHash(share.writeToken),
    }),
  });
  if (!response.ok) throw new Error(`Could not create friend share (${response.status})`);
}

export async function uploadFriendTimetable(share: OwnedFriendShare, timetable: SyncedTimetable): Promise<void> {
  const envelope = await encryptFriendTimetable(timetable, share.access);
  const response = await shareRequest(
    share.access,
    `/v1/shares/${encodeURIComponent(share.access.shareId)}`,
    share.writeToken,
    { method: 'PUT', body: JSON.stringify({ envelope }) },
  );
  if (response.status === 409) return;
  if (!response.ok) throw new Error('Friend timetable could not be updated');
}

export async function downloadFriendTimetable(access: FriendShareAccess): Promise<SyncedTimetable | undefined> {
  const response = await shareRequest(access, `/v1/shares/${encodeURIComponent(access.shareId)}`, access.readToken);
  if (response.status === 404) throw new Error('Friend share was revoked or expired');
  if (response.status === 204) return undefined;
  const body = (await response.json()) as { envelope?: FriendEnvelope };
  if (!body.envelope) throw new Error('Friend timetable is missing');
  return decryptFriendTimetable(body.envelope, access);
}

export async function revokeFriendShare(share: OwnedFriendShare): Promise<void> {
  const response = await shareRequest(
    share.access,
    `/v1/shares/${encodeURIComponent(share.access.shareId)}`,
    share.writeToken,
    { method: 'DELETE' },
  );
  if (!response.ok && response.status !== 404) throw new Error('Friend share could not be revoked');
}

export async function createFriendPushConnection(
  friendId: string,
  access: FriendShareAccess,
  deviceId: string,
): Promise<FriendPushConnection> {
  const path = `/v1/shares/${encodeURIComponent(access.shareId)}/socket-ticket`;
  const response = await shareRequest(access, path, access.readToken, {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
  const body = (await response.json()) as { ticket?: unknown; expiresAt?: unknown };
  if (typeof body.ticket !== 'string' || typeof body.expiresAt !== 'number') throw new Error('Friend push ticket is missing');
  const url = new URL(`${access.endpoint}/v1/shares/${encodeURIComponent(access.shareId)}/socket`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', body.ticket);
  return { friendId, url: url.toString(), expiresAt: body.expiresAt };
}
