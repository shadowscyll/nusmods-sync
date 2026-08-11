import { describe, expect, it } from 'vitest';

import {
  createProfile,
  createBlankProfileTab,
  deleteProfile,
  duplicateProfile,
  nextProfileName,
  normalizeProfileName,
  renameProfile,
  reorderProfiles,
  updateProfileTimetable,
} from '../src/sync/profiles';
import { timetable } from './fixtures';

describe('timetable profiles', () => {
  it('creates, renames, duplicates, and deletes profiles deterministically', () => {
    const first = createProfile([], timetable(), '  No Friday   classes ', 10, 'profile_one');
    expect(first[0].name).toBe('No Friday classes');
    const renamed = renameProfile(first, 'profile_one', 'Compact schedule');
    const duplicated = duplicateProfile(renamed, 'profile_one', 20, 'profile_two');
    expect(duplicated.map((profile) => profile.name)).toEqual([
      'Compact schedule',
      'Compact schedule copy',
    ]);
    expect(deleteProfile(duplicated, 'profile_one').map((profile) => profile.id)).toEqual([
      'profile_two',
    ]);
  });

  it('updates only the active profile snapshot', () => {
    const profiles = createProfile([], timetable(), 'Semester 1', 10, 'profile_one');
    const changed = timetable({ semester: 2, updatedAt: 2_000 });
    const updated = updateProfileTimetable(profiles, 'profile_one', changed, 30);
    expect(updated[0].timetable.semester).toBe(2);
    expect(updated[0].updatedAt).toBe(30);
    expect(profiles[0].timetable.semester).toBe(1);
  });

  it('generates readable unique names and validates user names', () => {
    const profiles = createProfile([], timetable(), '1', 10, 'profile_one');
    expect(nextProfileName(profiles, 1)).toBe('2');
    expect(() => normalizeProfileName('   ')).toThrow(/empty/u);
    expect(() => normalizeProfileName('x'.repeat(41))).toThrow(/40/u);
  });

  it('turns the first plus action into two real timetable tabs', () => {
    const current = timetable({ modules: [{
      moduleCode: 'CS1010S',
      hidden: false,
      isTa: false,
      selections: [],
    }] });
    const created = createBlankProfileTab([], current, undefined, 2_000, ['profile_one', 'profile_two']);
    expect(created.profiles.map((profile) => profile.name)).toEqual(['1', '2']);
    expect(created.profiles[0].timetable.modules).toHaveLength(1);
    expect(created.profile.id).toBe('profile_two');
    expect(created.profile.timetable.modules).toEqual([]);
  });

  it('creates one new empty tab after profiles already exist', () => {
    const current = timetable({ updatedAt: 1_000 });
    const existing = createProfile([], current, '1', 10, 'profile_one');
    const created = createBlankProfileTab(existing, current, 'profile_one', 2_000, ['profile_two']);
    expect(created.profiles.map((profile) => profile.name)).toEqual(['1', '2']);
    expect(created.profile.timetable.modules).toEqual([]);
  });

  it('reorders profiles only when every tab is present once', () => {
    const first = createProfile([], timetable(), '1', 10, 'profile_one');
    const profiles = createProfile(first, timetable(), '2', 20, 'profile_two');
    expect(reorderProfiles(profiles, ['profile_two', 'profile_one']).map((profile) => profile.name))
      .toEqual(['2', '1']);
    expect(() => reorderProfiles(profiles, ['profile_one', 'profile_one'])).toThrow(/order/u);
  });
});
