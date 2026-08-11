import { describe, expect, it } from 'vitest';

import { classifyRemoteUpdate } from '../src/sync/conflicts';
import { workspaceHash } from '../src/sync/comparison';
import { timetable, workspace } from './fixtures';

describe('last-write-wins conflict handling', () => {
  const local = workspace({ updatedAt: 100, deviceId: 'device_local' });
  const remote = workspace({
    updatedAt: 200,
    deviceId: 'device_remote',
    timetable: timetable({ updatedAt: 200, deviceId: 'device_remote', modules: [] }),
  });

  it('offers a newer remote update when local state was published', () => {
    expect(
      classifyRemoteUpdate(local, remote, 'device_local', {
        status: 'synced',
        lastPublishedHash: workspaceHash(local),
        lastSyncedAt: 100,
      }),
    ).toEqual({ kind: 'offer-remote' });
  });

  it('reports a conflict when local state is unpublished', () => {
    expect(
      classifyRemoteUpdate(local, remote, 'device_local', {
        status: 'error',
        lastPublishedHash: 'older-content',
      }),
    ).toEqual({ kind: 'conflict' });
  });

  it('recognizes a profile-only remote workspace change', () => {
    const localWithTab = workspace({
      updatedAt: 100,
      deviceId: 'device_local',
      profiles: [{ id: 'profile_one', name: '1', timetable: local.timetable, createdAt: 1, updatedAt: 1 }],
      activeProfileId: 'profile_one',
    });
    const remoteWithRename = {
      ...localWithTab,
      updatedAt: 200,
      deviceId: 'device_remote',
      profiles: [{ ...localWithTab.profiles[0], name: 'Main' }],
    };
    expect(classifyRemoteUpdate(localWithTab, remoteWithRename, 'device_local', {
      status: 'synced',
      lastPublishedHash: workspaceHash(localWithTab),
      lastSyncedAt: 100,
    })).toEqual({ kind: 'offer-remote' });
  });

  it('ignores its own and older updates', () => {
    expect(classifyRemoteUpdate(local, { ...remote, deviceId: 'device_local' }, 'device_local', { status: 'synced' })).toEqual({
      kind: 'ignore',
      reason: 'same-device',
    });
    expect(classifyRemoteUpdate(local, { ...remote, updatedAt: 99 }, 'device_local', { status: 'synced', lastSyncedAt: 100 })).toEqual({
      kind: 'ignore',
      reason: 'not-newer',
    });
  });
});
