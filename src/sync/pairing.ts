import { RELAY_URL } from '../shared/constants';
import type { RelayPairing } from '../shared/types';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToCrockford,
  decodeUtf8,
  randomBase64Url,
  utf8,
} from './encoding';

export type PairingHandoffEnvelope = { iv: string; ciphertext: string };

function configuredEndpoint(): string {
  return RELAY_URL.replace(/\/$/u, '');
}

export function isRelayConfigured(): boolean {
  return !configuredEndpoint().includes('relay-not-configured.invalid');
}

export function createPairing(): RelayPairing {
  if (!isRelayConfigured()) throw new Error('Relay URL is not configured in this build');
  return {
    version: 1,
    endpoint: configuredEndpoint(),
    vaultId: randomBase64Url(16),
    encryptionKey: randomBase64Url(32),
    writeToken: randomBase64Url(16),
  };
}

export function normalizePairingCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[\s-]/gu, '').replace(/O/gu, '0').replace(/[IL]/gu, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{4}$/u.test(normalized)) throw new Error('Pairing code must contain 4 characters');
  return normalized;
}

async function pairingKeyAndId(code: string): Promise<{ key: CryptoKey; id: string }> {
  const normalized = normalizePairingCode(code);
  const codeBytes = utf8(normalized);
  const [keyBytes, idBytes] = await Promise.all([
    crypto.subtle.digest('SHA-256', utf8(`nusmods-sync:pairing-key:${normalized}`)),
    crypto.subtle.digest('SHA-256', codeBytes),
  ]);
  return {
    key: await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']),
    id: bytesToBase64Url(new Uint8Array(idBytes)),
  };
}

export async function createPairingHandoff(pairing: RelayPairing): Promise<{
  code: string;
  id: string;
  envelope: PairingHandoffEnvelope;
}> {
  const code = bytesToCrockford(crypto.getRandomValues(new Uint8Array(3))).slice(0, 4);
  const { key, id } = await pairingKeyAndId(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(id), tagLength: 128 },
    key,
    utf8(JSON.stringify(pairing)),
  );
  return {
    code,
    id,
    envelope: { iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)) },
  };
}

export async function openPairingHandoff(
  code: string,
  envelope: PairingHandoffEnvelope,
): Promise<RelayPairing> {
  const { key, id } = await pairingKeyAndId(code);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv), additionalData: utf8(id), tagLength: 128 },
      key,
      base64UrlToBytes(envelope.ciphertext),
    );
    const pairing = JSON.parse(decodeUtf8(new Uint8Array(plaintext))) as unknown;
    const validated = validateStoredPairing(pairing);
    if (!validated) throw new Error('Pairing data is invalid');
    return validated;
  } catch {
    throw new Error('Pairing code is invalid or expired');
  }
}

export async function pairingCodeId(code: string): Promise<string> {
  return (await pairingKeyAndId(code)).id;
}

export function validateStoredPairing(value: unknown): RelayPairing | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const pairing = value as Partial<RelayPairing>;
  try {
    if (
      pairing.version !== 1 ||
      pairing.endpoint !== configuredEndpoint() ||
      typeof pairing.vaultId !== 'string' ||
      base64UrlToBytes(pairing.vaultId).length !== 16 ||
      typeof pairing.encryptionKey !== 'string' ||
      base64UrlToBytes(pairing.encryptionKey).length !== 32 ||
      typeof pairing.writeToken !== 'string' ||
      base64UrlToBytes(pairing.writeToken).length !== 16
    ) return undefined;
    return pairing as RelayPairing;
  } catch {
    return undefined;
  }
}
