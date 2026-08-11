export function bytesToBase64Url(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url value');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomBase64Url(byteLength: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

export function decodeUtf8(value: Uint8Array<ArrayBufferLike>): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function bytesToCrockford(value: Uint8Array<ArrayBufferLike>): string {
  let buffer = 0;
  let bits = 0;
  let encoded = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += CROCKFORD_ALPHABET[(buffer >>> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) encoded += CROCKFORD_ALPHABET[(buffer << (5 - bits)) & 31];
  return encoded.match(/.{1,4}/gu)?.join('-') ?? '';
}

export function crockfordToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.toUpperCase().replace(/[\s-]/gu, '').replace(/O/gu, '0').replace(/[IL]/gu, '1');
  if (normalized.length === 0) throw new Error('Invalid compact code');
  let buffer = 0;
  let bits = 0;
  const decoded: number[] = [];
  for (const character of normalized) {
    const index = CROCKFORD_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid compact code');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((buffer >>> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) throw new Error('Invalid compact code padding');
  return Uint8Array.from(decoded);
}
