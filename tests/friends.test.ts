import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { RELAY_URL } from '../src/shared/constants';
import type { FriendShareAccess } from '../src/shared/types';
import {
  createOwnedFriendShare,
  decodeFriendLink,
  decryptFriendTimetable,
  encodeFriendLink,
  encryptFriendTimetable,
} from '../src/sync/friends';
import { timetable } from './fixtures';

const access: FriendShareAccess = {
  version: 1,
  endpoint: RELAY_URL,
  shareId: 'abcdefghijklmnopqrstuv',
  encryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  readToken: 'BBBBBBBBBBBBBBBBBBBBBB',
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('friend timetable sharing', () => {
  it('round-trips an encrypted timetable without plaintext in the envelope', async () => {
    const original = timetable();
    const envelope = await encryptFriendTimetable(original, access);
    expect(envelope.ciphertext).not.toContain('CS2040S');
    await expect(decryptFriendTimetable(envelope, access)).resolves.toEqual(original);
  });

  it('encodes credentials only in the URL fragment', () => {
    const link = encodeFriendLink(access);
    expect(link).toMatch(/^https:\/\/nusmods\.com\/timetable\/sem-1#nmsf=/u);
    expect(link.split('#')[0]).not.toContain(access.readToken);
    expect(decodeFriendLink(link)).toEqual(access);
  });

  it('creates a short self-contained friend link', () => {
    const created = createOwnedFriendShare('My timetable', 'profile-1');
    const link = encodeFriendLink(created.access);
    expect(link.length).toBeLessThan(125);
    expect(decodeFriendLink(link)).toEqual(created.access);
  });

  it('rejects malformed links', () => {
    expect(() => decodeFriendLink('not-a-link')).toThrow('Friend link is invalid');
  });
});
