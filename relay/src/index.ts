interface Env {
  DB: D1Database;
  SYNC_ROOMS: DurableObjectNamespace;
}

type VaultRow = {
  token_hash: string;
  envelope_json: string | null;
  client_updated_at: number | null;
  device_id: string | null;
  updated_at: number;
  expires_at: number;
};

type FriendShareRow = {
  read_token_hash: string;
  write_token_hash: string;
  envelope_json: string | null;
  client_updated_at: number | null;
  device_id: string | null;
  expires_at: number;
};

type Envelope = {
  envelopeVersion: 1 | 2;
  revision?: number;
  updatedAt: number;
  deviceId: string;
  iv: string;
  ciphertext: string;
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Cache-Control': 'no-store',
};
const MAX_BODY_BYTES = 262_144;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const PAIRING_RETENTION_MS = 10 * 60 * 1_000;
const SOCKET_TICKET_RETENTION_MS = 30 * 1_000;

type SocketTicket = {
  deviceId: string;
  expiresAt: number;
};

type SocketAttachment = {
  deviceId: string;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function validCapability(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,64}$/u.test(value);
}

async function sha256Base64Url(value: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  let binary = '';
  for (const byte of hash) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function randomBase64Url(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) throw new Error('Payload is too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error('Payload is too large');
  return JSON.parse(text) as unknown;
}

function parseEnvelope(value: unknown): Envelope {
  if (typeof value !== 'object' || value === null) throw new Error('Envelope is missing');
  const envelope = value as Partial<Envelope>;
  if (
    (envelope.envelopeVersion !== 1 && envelope.envelopeVersion !== 2) ||
    !Number.isSafeInteger(envelope.updatedAt) ||
    Number(envelope.updatedAt) <= 0 ||
    typeof envelope.deviceId !== 'string' ||
    !/^device_[a-f0-9]{12}$/u.test(envelope.deviceId) ||
    typeof envelope.iv !== 'string' ||
    envelope.iv.length !== 16 ||
    typeof envelope.ciphertext !== 'string' ||
    envelope.ciphertext.length < 20 ||
    envelope.ciphertext.length > 240_000
  ) throw new Error('Envelope is invalid');
  if (
    envelope.envelopeVersion === 2 &&
    (!Number.isSafeInteger(envelope.revision) || Number(envelope.revision) <= 0)
  ) throw new Error('Envelope revision is invalid');
  return envelope as Envelope;
}

async function authenticateHash(request: Request, tokenHash: string): Promise<boolean> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice(7);
  return validCapability(token) && (await sha256Base64Url(token)) === tokenHash;
}

async function createVault(request: Request, env: Env): Promise<Response> {
  const body = (await readJson(request)) as { vaultId?: unknown; tokenHash?: unknown };
  if (!validCapability(body.vaultId) || !validCapability(body.tokenHash)) {
    return json({ error: 'Invalid vault' }, 400);
  }
  const now = Date.now();
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO vaults (vault_id, token_hash, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(body.vaultId, body.tokenHash, now, now, now + RETENTION_MS).run();
  return result.meta.changes === 1
    ? json({ created: true }, 201)
    : json({ error: 'Vault already exists' }, 409);
}

async function findVault(env: Env, vaultId: string): Promise<VaultRow | null> {
  return env.DB.prepare(
    'SELECT token_hash, envelope_json, client_updated_at, device_id, updated_at, expires_at FROM vaults WHERE vault_id = ?',
  ).bind(vaultId).first<VaultRow>();
}

async function getVault(request: Request, env: Env, vaultId: string): Promise<Response> {
  const row = await findVault(env, vaultId);
  if (!row || row.expires_at <= Date.now()) return json({ error: 'Vault not found' }, 404);
  if (!(await authenticateHash(request, row.token_hash))) return json({ error: 'Unauthorized' }, 401);
  if (!row.envelope_json) return new Response(null, { status: 204, headers: CORS_HEADERS });
  return json({ envelope: JSON.parse(row.envelope_json) as unknown });
}

async function putVault(request: Request, env: Env, vaultId: string): Promise<Response> {
  const row = await findVault(env, vaultId);
  if (!row || row.expires_at <= Date.now()) return json({ error: 'Vault not found' }, 404);
  if (!(await authenticateHash(request, row.token_hash))) return json({ error: 'Unauthorized' }, 401);
  const body = (await readJson(request)) as { envelope?: unknown };
  const envelope = parseEnvelope(body.envelope);
  if (envelope.envelopeVersion === 2) {
    const storedEnvelope = row.envelope_json ? parseEnvelope(JSON.parse(row.envelope_json) as unknown) : undefined;
    const currentRevision = storedEnvelope?.envelopeVersion === 2 ? Number(storedEnvelope.revision) : 0;
    if (envelope.revision !== currentRevision + 1) {
      return json({ error: 'A newer or identical revision already exists', revision: currentRevision }, 409);
    }
    const now = Math.max(Date.now(), row.updated_at + 1);
    const result = await env.DB.prepare(
      `UPDATE vaults
       SET envelope_json = ?, client_updated_at = ?, device_id = ?, updated_at = ?, expires_at = ?
       WHERE vault_id = ? AND updated_at = ?`,
    ).bind(
      JSON.stringify(envelope), envelope.updatedAt, envelope.deviceId, now, now + RETENTION_MS,
      vaultId, row.updated_at,
    ).run();
    if (result.meta.changes !== 1) return json({ error: 'A newer revision already exists' }, 409);
    const room = env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(vaultId));
    await room.fetch('https://sync-room/notify', {
      method: 'POST',
      body: JSON.stringify({ revision: envelope.revision, updatedAt: envelope.updatedAt, deviceId: envelope.deviceId }),
    }).catch(() => undefined);
    return json({ stored: true, revision: envelope.revision });
  }
  if (
    row.envelope_json &&
    parseEnvelope(JSON.parse(row.envelope_json) as unknown).envelopeVersion === 2
  ) return json({ error: 'Upgrade the extension before writing this vault' }, 409);
  const currentTime = row.client_updated_at ?? 0;
  const currentDevice = row.device_id ?? '';
  if (
    envelope.updatedAt < currentTime ||
    (envelope.updatedAt === currentTime && envelope.deviceId <= currentDevice)
  ) return json({ error: 'A newer or identical version already exists' }, 409);
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE vaults
     SET envelope_json = ?, client_updated_at = ?, device_id = ?, updated_at = ?, expires_at = ?
     WHERE vault_id = ? AND updated_at = ? AND (
       client_updated_at IS NULL OR client_updated_at < ? OR
       (client_updated_at = ? AND COALESCE(device_id, '') < ?)
     )`,
  ).bind(
    JSON.stringify(envelope), envelope.updatedAt, envelope.deviceId, now, now + RETENTION_MS,
    vaultId, row.updated_at, envelope.updatedAt, envelope.updatedAt, envelope.deviceId,
  ).run();
  if (result.meta.changes !== 1) return json({ error: 'A newer or identical version already exists' }, 409);
  const room = env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(vaultId));
  await room.fetch('https://sync-room/notify', {
    method: 'POST',
    body: JSON.stringify({ updatedAt: envelope.updatedAt, deviceId: envelope.deviceId }),
  }).catch(() => undefined);
  return json({ stored: true });
}

async function acknowledgeVault(request: Request, env: Env, vaultId: string): Promise<Response> {
  const row = await findVault(env, vaultId);
  if (!row || row.expires_at <= Date.now()) return json({ error: 'Vault not found' }, 404);
  if (!(await authenticateHash(request, row.token_hash))) return json({ error: 'Unauthorized' }, 401);
  const body = (await readJson(request)) as { deviceId?: unknown; revision?: unknown };
  if (
    typeof body.deviceId !== 'string' || !/^device_[a-f0-9]{12}$/u.test(body.deviceId) ||
    !Number.isSafeInteger(body.revision) || Number(body.revision) <= 0
  ) return json({ error: 'Invalid acknowledgement' }, 400);
  const storedEnvelope = row.envelope_json ? parseEnvelope(JSON.parse(row.envelope_json) as unknown) : undefined;
  const currentRevision = storedEnvelope?.envelopeVersion === 2 ? Number(storedEnvelope.revision) : 0;
  if (Number(body.revision) > currentRevision) return json({ error: 'Revision does not exist' }, 409);
  const room = env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(vaultId));
  const response = await room.fetch('https://sync-room/ack', {
    method: 'POST',
    body: JSON.stringify({ revision: body.revision, deviceId: body.deviceId }),
  });
  return response.ok ? json({ acknowledged: true, revision: body.revision }) : json({ error: 'Could not acknowledge revision' }, 503);
}

async function createSocketTicket(request: Request, env: Env, vaultId: string): Promise<Response> {
  const row = await findVault(env, vaultId);
  if (!row || row.expires_at <= Date.now()) return json({ error: 'Vault not found' }, 404);
  if (!(await authenticateHash(request, row.token_hash))) return json({ error: 'Unauthorized' }, 401);
  const body = (await readJson(request)) as { deviceId?: unknown };
  if (typeof body.deviceId !== 'string' || !/^device_[a-f0-9]{12}$/u.test(body.deviceId)) {
    return json({ error: 'Invalid device' }, 400);
  }
  const ticket = randomBase64Url();
  const expiresAt = Date.now() + SOCKET_TICKET_RETENTION_MS;
  const room = env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(vaultId));
  const response = await room.fetch('https://sync-room/ticket', {
    method: 'POST',
    body: JSON.stringify({ ticket, deviceId: body.deviceId, expiresAt }),
  });
  if (!response.ok) return json({ error: 'Could not create push connection' }, 503);
  return json({ ticket, expiresAt }, 201);
}

async function connectSocket(request: Request, env: Env, vaultId: string): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'WebSocket upgrade required' }, 426);
  }
  const room = env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(vaultId));
  return room.fetch(request);
}

async function createFriendShare(request: Request, env: Env): Promise<Response> {
  const body = (await readJson(request)) as { shareId?: unknown; readTokenHash?: unknown; writeTokenHash?: unknown };
  if (!validCapability(body.shareId) || !validCapability(body.readTokenHash) || !validCapability(body.writeTokenHash)) {
    return json({ error: 'Invalid friend share' }, 400);
  }
  const now = Date.now();
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO friend_shares (share_id, read_token_hash, write_token_hash, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(body.shareId, body.readTokenHash, body.writeTokenHash, now, now, now + RETENTION_MS).run();
  return result.meta.changes === 1 ? json({ created: true }, 201) : json({ error: 'Share already exists' }, 409);
}

async function findFriendShare(env: Env, shareId: string): Promise<FriendShareRow | null> {
  return env.DB.prepare(
    'SELECT read_token_hash, write_token_hash, envelope_json, client_updated_at, device_id, expires_at FROM friend_shares WHERE share_id = ?',
  ).bind(shareId).first<FriendShareRow>();
}

async function getFriendShare(request: Request, env: Env, shareId: string): Promise<Response> {
  const row = await findFriendShare(env, shareId);
  if (!row || row.expires_at <= Date.now()) return json({ error: 'Friend share not found' }, 404);
  if (!(await authenticateHash(request, row.read_token_hash))) return json({ error: 'Unauthorized' }, 401);
  if (!row.envelope_json) return new Response(null, { status: 204, headers: CORS_HEADERS });
  return json({ envelope: JSON.parse(row.envelope_json) as unknown });
}

async function putFriendShare(request: Request, env: Env, shareId: string): Promise<Response> {
  const row = await findFriendShare(env, shareId);
  if (!row || row.expires_at <= Date.now()) return json({ error: 'Friend share not found' }, 404);
  if (!(await authenticateHash(request, row.write_token_hash))) return json({ error: 'Unauthorized' }, 401);
  const body = (await readJson(request)) as { envelope?: unknown };
  const envelope = parseEnvelope(body.envelope);
  const currentTime = row.client_updated_at ?? 0;
  const currentDevice = row.device_id ?? '';
  if (envelope.updatedAt < currentTime || (envelope.updatedAt === currentTime && envelope.deviceId <= currentDevice)) {
    return json({ error: 'A newer or identical version already exists' }, 409);
  }
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE friend_shares
     SET envelope_json = ?, client_updated_at = ?, device_id = ?, updated_at = ?, expires_at = ?
     WHERE share_id = ? AND (
       client_updated_at IS NULL OR client_updated_at < ? OR
       (client_updated_at = ? AND COALESCE(device_id, '') < ?)
     )`,
  ).bind(
    JSON.stringify(envelope), envelope.updatedAt, envelope.deviceId, now, now + RETENTION_MS,
    shareId, envelope.updatedAt, envelope.updatedAt, envelope.deviceId,
  ).run();
  if (result.meta.changes !== 1) return json({ error: 'A newer or identical version already exists' }, 409);
  const room = env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(`share:${shareId}`));
  await room.fetch('https://sync-room/notify', {
    method: 'POST',
    body: JSON.stringify({ updatedAt: envelope.updatedAt, deviceId: envelope.deviceId }),
  }).catch(() => undefined);
  return json({ stored: true });
}

async function deleteFriendShare(request: Request, env: Env, shareId: string): Promise<Response> {
  const row = await findFriendShare(env, shareId);
  if (!row) return json({ error: 'Friend share not found' }, 404);
  if (!(await authenticateHash(request, row.write_token_hash))) return json({ error: 'Unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM friend_shares WHERE share_id = ?').bind(shareId).run();
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function createFriendSocketTicket(request: Request, env: Env, shareId: string): Promise<Response> {
  const row = await findFriendShare(env, shareId);
  if (!row || row.expires_at <= Date.now()) return json({ error: 'Friend share not found' }, 404);
  if (!(await authenticateHash(request, row.read_token_hash))) return json({ error: 'Unauthorized' }, 401);
  const body = (await readJson(request)) as { deviceId?: unknown };
  if (typeof body.deviceId !== 'string' || !/^device_[a-f0-9]{12}$/u.test(body.deviceId)) return json({ error: 'Invalid device' }, 400);
  const ticket = randomBase64Url();
  const expiresAt = Date.now() + SOCKET_TICKET_RETENTION_MS;
  const room = env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(`share:${shareId}`));
  const response = await room.fetch('https://sync-room/ticket', {
    method: 'POST',
    body: JSON.stringify({ ticket, deviceId: body.deviceId, expiresAt }),
  });
  return response.ok ? json({ ticket, expiresAt }, 201) : json({ error: 'Could not create push connection' }, 503);
}

async function connectFriendSocket(request: Request, env: Env, shareId: string): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket upgrade required' }, 426);
  return env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(`share:${shareId}`)).fetch(request);
}

function parsePairingEnvelope(value: unknown): { iv: string; ciphertext: string } {
  if (typeof value !== 'object' || value === null) throw new Error('Pairing payload is missing');
  const envelope = value as { iv?: unknown; ciphertext?: unknown };
  if (
    typeof envelope.iv !== 'string' || envelope.iv.length !== 16 ||
    typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 80 || envelope.ciphertext.length > 2_000
  ) throw new Error('Pairing payload is invalid');
  return envelope as { iv: string; ciphertext: string };
}

async function createPairingHandoff(request: Request, env: Env, pairingId: string): Promise<Response> {
  const body = (await readJson(request)) as { envelope?: unknown };
  const envelope = parsePairingEnvelope(body.envelope);
  const now = Date.now();
  const expiresAt = now + PAIRING_RETENTION_MS;
  await env.DB.prepare('DELETE FROM pairing_handoffs WHERE expires_at <= ?').bind(now).run();
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO pairing_handoffs (pairing_id, envelope_json, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(pairingId, JSON.stringify(envelope), now, expiresAt).run();
  return result.meta.changes === 1
    ? json({ created: true, expiresAt }, 201)
    : json({ error: 'Pairing code collision' }, 409);
}

async function redeemPairingHandoff(env: Env, pairingId: string): Promise<Response> {
  const now = Date.now();
  const row = await env.DB.prepare(
    'DELETE FROM pairing_handoffs WHERE pairing_id = ? AND expires_at > ? RETURNING envelope_json, expires_at',
  ).bind(pairingId, now).first<{ envelope_json: string; expires_at: number }>();
  if (!row) {
    await env.DB.prepare('DELETE FROM pairing_handoffs WHERE pairing_id = ?').bind(pairingId).run();
    return json({ error: 'Pairing code not found' }, 404);
  }
  return json({ envelope: JSON.parse(row.envelope_json) as unknown });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, version: '1.1.0' });
      if (url.pathname === '/v1/vaults' && request.method === 'POST') return createVault(request, env);
      if (url.pathname === '/v1/shares' && request.method === 'POST') return createFriendShare(request, env);
      const pairingMatch = url.pathname.match(/^\/v1\/pairings\/([A-Za-z0-9_-]{43})$/u);
      if (pairingMatch && request.method === 'POST') return createPairingHandoff(request, env, pairingMatch[1]);
      if (pairingMatch && request.method === 'GET') return redeemPairingHandoff(env, pairingMatch[1]);
      const match = url.pathname.match(/^\/v1\/vaults\/([A-Za-z0-9_-]{20,64})$/u);
      const socketTicketMatch = url.pathname.match(/^\/v1\/vaults\/([A-Za-z0-9_-]{20,64})\/socket-ticket$/u);
      const ackMatch = url.pathname.match(/^\/v1\/vaults\/([A-Za-z0-9_-]{20,64})\/ack$/u);
      if (ackMatch && request.method === 'POST') return acknowledgeVault(request, env, ackMatch[1]);
      if (socketTicketMatch && request.method === 'POST') return createSocketTicket(request, env, socketTicketMatch[1]);
      const socketMatch = url.pathname.match(/^\/v1\/vaults\/([A-Za-z0-9_-]{20,64})\/socket$/u);
      if (socketMatch && request.method === 'GET') return connectSocket(request, env, socketMatch[1]);
      const friendMatch = url.pathname.match(/^\/v1\/shares\/([A-Za-z0-9_-]{20,64})$/u);
      const friendTicketMatch = url.pathname.match(/^\/v1\/shares\/([A-Za-z0-9_-]{20,64})\/socket-ticket$/u);
      const friendSocketMatch = url.pathname.match(/^\/v1\/shares\/([A-Za-z0-9_-]{20,64})\/socket$/u);
      if (friendTicketMatch && request.method === 'POST') return createFriendSocketTicket(request, env, friendTicketMatch[1]);
      if (friendSocketMatch && request.method === 'GET') return connectFriendSocket(request, env, friendSocketMatch[1]);
      if (friendMatch && request.method === 'GET') return getFriendShare(request, env, friendMatch[1]);
      if (friendMatch && request.method === 'PUT') return putFriendShare(request, env, friendMatch[1]);
      if (friendMatch && request.method === 'DELETE') return deleteFriendShare(request, env, friendMatch[1]);
      if (!match) return json({ error: 'Not found' }, 404);
      if (request.method === 'GET') return getVault(request, env, match[1]);
      if (request.method === 'PUT') return putVault(request, env, match[1]);
      return json({ error: 'Method not allowed' }, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      return json({ error: message }, message === 'Payload is too large' ? 413 : 400);
    }
  },
};

export class SyncRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ticket' && request.method === 'POST') {
      const ticket = (await request.json()) as Partial<SocketTicket> & { ticket?: unknown };
      if (
        typeof ticket.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(ticket.ticket) ||
        typeof ticket.deviceId !== 'string' || !/^device_[a-f0-9]{12}$/u.test(ticket.deviceId) ||
        !Number.isSafeInteger(ticket.expiresAt) || Number(ticket.expiresAt) <= Date.now()
      ) return new Response(null, { status: 400 });
      const existingTickets = await this.state.storage.list<SocketTicket>({ prefix: 'ticket:' });
      await Promise.all(
        [...existingTickets.entries()]
          .filter(([, value]) => value.expiresAt <= Date.now())
          .map(([key]) => this.state.storage.delete(key)),
      );
      await this.state.storage.put(`ticket:${ticket.ticket}`, {
        deviceId: ticket.deviceId,
        expiresAt: ticket.expiresAt,
      } satisfies SocketTicket);
      return new Response(null, { status: 204 });
    }

    if (url.pathname.endsWith('/socket') && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const ticket = url.searchParams.get('ticket');
      if (!ticket || !/^[A-Za-z0-9_-]{43}$/u.test(ticket)) return new Response(null, { status: 401 });
      const key = `ticket:${ticket}`;
      const stored = await this.state.storage.get<SocketTicket>(key);
      await this.state.storage.delete(key);
      if (!stored || stored.expiresAt <= Date.now()) return new Response(null, { status: 401 });
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.serializeAttachment({ deviceId: stored.deviceId } satisfies SocketAttachment);
      this.state.acceptWebSocket(server);
      const acknowledgements = await this.state.storage.list<number>({ prefix: 'ack:' });
      for (const [ackKey, revision] of acknowledgements) {
        server.send(JSON.stringify({ type: 'acknowledged', deviceId: ackKey.slice(4), revision }));
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      const update = (await request.json()) as { revision?: unknown; updatedAt?: unknown; deviceId?: unknown };
      if (!Number.isSafeInteger(update.updatedAt) || typeof update.deviceId !== 'string') {
        return new Response(null, { status: 400 });
      }
      const message = JSON.stringify({ type: 'updated', revision: update.revision, updatedAt: update.updatedAt });
      for (const socket of this.state.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment?.deviceId === update.deviceId) continue;
        try {
          socket.send(message);
        } catch {
          try { socket.close(1011, 'Push failed'); } catch { /* Socket is already closed. */ }
        }
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/ack' && request.method === 'POST') {
      const ack = (await request.json()) as { revision?: unknown; deviceId?: unknown };
      if (
        !Number.isSafeInteger(ack.revision) || Number(ack.revision) <= 0 ||
        typeof ack.deviceId !== 'string' || !/^device_[a-f0-9]{12}$/u.test(ack.deviceId)
      ) return new Response(null, { status: 400 });
      const key = `ack:${ack.deviceId}`;
      const previous = await this.state.storage.get<number>(key) ?? 0;
      if (Number(ack.revision) > previous) await this.state.storage.put(key, Number(ack.revision));
      const message = JSON.stringify({ type: 'acknowledged', revision: ack.revision, deviceId: ack.deviceId });
      for (const socket of this.state.getWebSockets()) {
        try { socket.send(message); } catch { /* A reconnect will replay stored acknowledgements. */ }
      }
      return new Response(null, { status: 204 });
    }

    return new Response(null, { status: 404 });
  }

  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
    if (message === 'ping') socket.send('pong');
  }
}
