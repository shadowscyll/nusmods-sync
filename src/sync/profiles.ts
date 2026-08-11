import { PROFILE_LIMIT } from '../shared/constants';
import type { SyncedTimetable, TimetableProfile } from '../shared/types';

export function normalizeProfileName(value: string): string {
  const name = value.trim().replace(/\s+/gu, ' ');
  if (name.length === 0) throw new Error('Timetable name cannot be empty');
  if (name.length > 40) throw new Error('Timetable name must be 40 characters or fewer');
  return name;
}

export function nextProfileName(profiles: TimetableProfile[], _semester: number): string {
  const names = new Set(profiles.map((profile) => profile.name.toLocaleLowerCase()));
  for (let suffix = 1; suffix <= PROFILE_LIMIT + 1; suffix += 1) {
    const candidate = String(suffix);
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return String(profiles.length + 1);
}

export function createProfile(
  profiles: TimetableProfile[],
  timetable: SyncedTimetable,
  name: string,
  now = Date.now(),
  id = `profile_${crypto.randomUUID()}`,
): TimetableProfile[] {
  if (profiles.length >= PROFILE_LIMIT) throw new Error(`You can save up to ${PROFILE_LIMIT} timetables`);
  const profile: TimetableProfile = {
    id,
    name: normalizeProfileName(name),
    timetable,
    createdAt: now,
    updatedAt: now,
  };
  return [...profiles, profile];
}

export function createBlankProfileTab(
  profiles: TimetableProfile[],
  current: SyncedTimetable,
  activeProfileId: string | undefined,
  now = Date.now(),
  ids: string[] = [],
): { profiles: TimetableProfile[]; profile: TimetableProfile } {
  const nextId = (): string => ids.shift() ?? `profile_${crypto.randomUUID()}`;
  let next = profiles;
  if (next.length === 0) {
    next = createProfile(next, current, nextProfileName(next, current.semester), now, nextId());
  } else if (activeProfileId && next.some((profile) => profile.id === activeProfileId)) {
    next = updateProfileTimetable(next, activeProfileId, current, now);
  }
  const blank: SyncedTimetable = {
    ...current,
    modules: [],
    updatedAt: Math.max(now, current.updatedAt + 1),
  };
  next = createProfile(next, blank, nextProfileName(next, blank.semester), now, nextId());
  return { profiles: next, profile: next.at(-1)! };
}

export function updateProfileTimetable(
  profiles: TimetableProfile[],
  profileId: string,
  timetable: SyncedTimetable,
  now = Date.now(),
): TimetableProfile[] {
  return profiles.map((profile) =>
    profile.id === profileId ? { ...profile, timetable, updatedAt: now } : profile,
  );
}

export function renameProfile(
  profiles: TimetableProfile[],
  profileId: string,
  name: string,
): TimetableProfile[] {
  const normalized = normalizeProfileName(name);
  let found = false;
  const next = profiles.map((profile) => {
    if (profile.id !== profileId) return profile;
    found = true;
    return { ...profile, name: normalized };
  });
  if (!found) throw new Error('Saved timetable was not found');
  return next;
}

export function duplicateProfile(
  profiles: TimetableProfile[],
  profileId: string,
  now = Date.now(),
  id = `profile_${crypto.randomUUID()}`,
): TimetableProfile[] {
  const source = profiles.find((profile) => profile.id === profileId);
  if (!source) throw new Error('Saved timetable was not found');
  return createProfile(profiles, source.timetable, `${source.name.slice(0, 35)} copy`, now, id);
}

export function deleteProfile(profiles: TimetableProfile[], profileId: string): TimetableProfile[] {
  if (!profiles.some((profile) => profile.id === profileId)) throw new Error('Saved timetable was not found');
  return profiles.filter((profile) => profile.id !== profileId);
}

export function reorderProfiles(
  profiles: TimetableProfile[],
  profileIds: string[],
): TimetableProfile[] {
  if (
    profileIds.length !== profiles.length ||
    new Set(profileIds).size !== profiles.length ||
    profileIds.some((id) => !profiles.some((profile) => profile.id === id))
  ) throw new Error('Timetable order is invalid');
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return profileIds.map((id) => byId.get(id)!);
}
