import type { ExtensionSettings } from './types';

export const NUSMODS_STORAGE_KEY = 'persist:timetables';
export const NUSMODS_STORAGE_EVENT = 'nusmods-sync:timetable-storage-changed';
export const RELAY_URL = __RELAY_URL__;
export const RELAY_POLL_ALARM = 'nusmodsSync.relayPoll';

export const LOCAL_KEYS = {
  deviceId: 'nusmodsSync.deviceId',
  current: 'nusmodsSync.localCurrent',
  history: 'nusmodsSync.history',
  pendingRemote: 'nusmodsSync.pendingRemote',
  ignoredRemote: 'nusmodsSync.ignoredRemote',
  metadata: 'nusmodsSync.metadata',
  settings: 'nusmodsSync.settings',
  relayPairing: 'nusmodsSync.relayPairing',
  pairingCode: 'nusmodsSync.pairingCode',
  profiles: 'nusmodsSync.profiles',
  activeProfileId: 'nusmodsSync.activeProfileId',
  ownedFriendShares: 'nusmodsSync.ownedFriendShares',
  friends: 'nusmodsSync.friends',
  activeFriendId: 'nusmodsSync.activeFriendId',
} as const;

export const DEFAULT_SETTINGS: ExtensionSettings = { autoSync: true, showCommonFreeTime: true };
export const HISTORY_LIMIT = 30;
// Same-page writes are reported immediately by the main-world bridge. This is
// only a low-frequency fallback for future NUSMods storage implementations.
export const WATCH_INTERVAL_MS = 5_000;
export const CAPTURE_BURST_SETTLE_MS = 200;
export const ACTIVE_POLL_MINUTES = 5;
export const IDLE_POLL_MINUTES = 15;
export const PROFILE_LIMIT = 10;

export const SEMESTER_PATHS: Readonly<Record<number, string>> = {
  1: 'sem-1',
  2: 'sem-2',
  3: 'st-i',
  4: 'st-ii',
};

export const PATH_SEMESTERS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(SEMESTER_PATHS).map(([semester, path]) => [path, Number(semester)]),
);

// Copied from current NUSMods website/src/utils/timetables/lessonId.ts.
// Unknown future lesson types fail closed during share-link generation.
export const LESSON_TYPE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  'Design Lecture': 'DLEC',
  Laboratory: 'LAB',
  Lecture: 'LEC',
  'Packaged Laboratory': 'PLAB',
  'Packaged Lecture': 'PLEC',
  'Packaged Tutorial': 'PTUT',
  Recitation: 'REC',
  'Sectional Teaching': 'SEC',
  'Seminar-Style Module Class': 'SEM',
  Tutorial: 'TUT',
  'Tutorial Type 2': 'TUT2',
  'Tutorial Type 3': 'TUT3',
  Workshop: 'WS',
};
