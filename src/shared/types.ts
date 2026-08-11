export const SCHEMA_VERSION = 1 as const;

export type ClassNoSelection = {
  kind: 'classNo';
  classNo: string;
};

export type LessonIdsSelection = {
  kind: 'lessonIds';
  lessonIds: string[];
};

export type SyncedLessonSelection = {
  lessonType: string;
  selection: ClassNoSelection | LessonIdsSelection;
};

export type SyncedModule = {
  moduleCode: string;
  hidden: boolean;
  isTa: boolean;
  selections: SyncedLessonSelection[];
};

export type TimetableData = {
  schemaVersion: typeof SCHEMA_VERSION;
  academicYear: string;
  semester: number;
  modules: SyncedModule[];
};

export type SyncedTimetable = TimetableData & {
  updatedAt: number;
  deviceId: string;
};

export type HistorySource = 'automatic' | 'manual' | 'before-restore' | 'restored';

export type HistorySnapshot = {
  id: string;
  timetable: SyncedTimetable;
  savedAt: number;
  source: HistorySource;
  summary: string;
};

export type SyncStatus = 'idle' | 'saving' | 'synced' | 'update-available' | 'conflict' | 'error';

export type ExtensionSettings = {
  autoSync: boolean;
  showCommonFreeTime: boolean;
};

export type RelayPairing = {
  version: 1;
  endpoint: string;
  vaultId: string;
  encryptionKey: string;
  writeToken: string;
};

export type PairingState =
  | { paired: false; relayConfigured: boolean }
  | { paired: true; relayConfigured: true; pairingCode?: string; pairingCodeExpiresAt?: number };

export type CachedPairingCode = { code: string; expiresAt: number };

export type PushConnection = { url: string; expiresAt: number };

export type FriendShareAccess = {
  version: 1;
  endpoint: string;
  shareId: string;
  encryptionKey: string;
  readToken: string;
};

export type OwnedFriendShare = {
  id: string;
  name: string;
  profileId?: string;
  access: FriendShareAccess;
  writeToken: string;
  createdAt: number;
};

export type FriendTimetable = {
  id: string;
  name: string;
  access: FriendShareAccess;
  timetable?: SyncedTimetable;
  updatedAt?: number;
  enabled: boolean;
};

export type FriendPushConnection = PushConnection & { friendId: string };

export type TimetableProfile = {
  id: string;
  name: string;
  timetable: SyncedTimetable;
  createdAt: number;
  updatedAt: number;
};

export type SyncedWorkspace = {
  workspaceVersion: 1;
  revision: number;
  updatedAt: number;
  deviceId: string;
  timetable: SyncedTimetable;
  profiles: TimetableProfile[];
  activeProfileId?: string;
};

export type PushStatus = 'live' | 'connecting' | 'reconnecting' | 'offline';

export type SyncMetadata = {
  status: SyncStatus;
  lastPublishedHash?: string;
  lastSyncedAt?: number;
  error?: string;
  payloadVersion?: 1;
  lastKnownRevision?: number;
  lastPublishedRevision?: number;
  revisionAcks?: Record<string, number>;
};

export type PopupState = {
  status: SyncStatus;
  lastSyncedAt?: number;
  current?: SyncedTimetable;
  pendingRemote?: SyncedWorkspace;
  history: HistorySnapshot[];
  settings: ExtensionSettings;
  error?: string;
  isNusmodsTab: boolean;
  pairing: PairingState;
  profiles: TimetableProfile[];
  activeProfileId?: string;
  pushStatus: PushStatus;
  ownedFriendShares: OwnedFriendShare[];
  friends: FriendTimetable[];
  activeFriendId?: string;
};

export type ConflictDecision =
  | { kind: 'ignore'; reason: 'same-device' | 'not-newer' | 'same-content' }
  | { kind: 'offer-remote' }
  | { kind: 'conflict' };

export type RuntimeMessage =
  | { type: 'TIMETABLE_DETECTED'; timetable: TimetableData }
  | { type: 'READ_TIMETABLE' }
  | { type: 'GET_POPUP_STATE' }
  | { type: 'SYNC_NOW' }
  | { type: 'GET_PAGE_STATE' }
  | { type: 'APPLY_PENDING_REMOTE' }
  | { type: 'APPLY_TIMETABLE'; timetable: SyncedTimetable }
  | { type: 'IGNORE_PENDING_REMOTE' }
  | { type: 'KEEP_LOCAL' }
  | { type: 'RESTORE_HISTORY'; snapshotId: string }
  | { type: 'SET_SETTINGS'; settings: Partial<ExtensionSettings> }
  | { type: 'CREATE_PAIRING' }
  | { type: 'CREATE_PAIRING_CODE' }
  | { type: 'JOIN_PAIRING'; pairingCode: string }
  | { type: 'DISCONNECT_PAIRING' }
  | { type: 'POLL_REMOTE' }
  | { type: 'GET_PUSH_CONNECTION' }
  | { type: 'SET_PUSH_STATUS'; status: PushStatus }
  | { type: 'RECORD_REVISION_ACK'; revision: number; deviceId: string }
  | { type: 'GET_CONTENT_PUSH_STATUS' }
  | { type: 'CREATE_FRIEND_SHARE'; name?: string }
  | { type: 'REVOKE_FRIEND_SHARE'; shareId: string }
  | { type: 'ADD_FRIEND'; shareLink: string; name?: string }
  | { type: 'REMOVE_FRIEND'; friendId: string }
  | { type: 'RENAME_FRIEND'; friendId: string; name: string }
  | { type: 'SET_FRIEND_ENABLED'; friendId: string; enabled: boolean }
  | { type: 'VIEW_FRIEND'; friendId?: string }
  | { type: 'POLL_FRIENDS' }
  | { type: 'GET_FRIEND_PUSH_CONNECTIONS' }
  | { type: 'SAVE_PROFILE'; name?: string }
  | { type: 'ADD_PROFILE_TAB' }
  | { type: 'ACTIVATE_PROFILE'; profileId?: string }
  | { type: 'RENAME_PROFILE'; profileId: string; name: string }
  | { type: 'DUPLICATE_PROFILE'; profileId: string }
  | { type: 'DELETE_PROFILE'; profileId: string }
  | { type: 'REORDER_PROFILES'; profileIds: string[] }
  | { type: 'STATE_CHANGED'; state: PopupState };

export type MessageResponse<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
