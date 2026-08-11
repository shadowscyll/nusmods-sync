import { ACTIVE_POLL_MINUTES, IDLE_POLL_MINUTES, RELAY_POLL_ALARM } from '../shared/constants';
import { errorMessage } from '../shared/errors';
import { debugLog, errorLog } from '../shared/log';
import { sendTabMessage } from '../shared/messages';
import type {
  ExtensionSettings,
  FriendPushConnection,
  MessageResponse,
  PairingState,
  PopupState,
  PushConnection,
  PushStatus,
  RuntimeMessage,
  SyncedTimetable,
  SyncedWorkspace,
  TimetableData,
} from '../shared/types';
import { webext } from '../shared/webext';
import { classifyRemoteUpdate } from '../sync/conflicts';
import { timetablesEqual, workspaceHash, workspacesEqual } from '../sync/comparison';
import { saveSnapshot } from '../sync/history';
import { createPairing, isRelayConfigured } from '../sync/pairing';
import {
  createProfile,
  createBlankProfileTab,
  deleteProfile,
  duplicateProfile,
  nextProfileName,
  renameProfile,
  reorderProfiles,
  updateProfileTimetable,
} from '../sync/profiles';
import {
  createShortPairingCode,
  createPushConnection,
  downloadWorkspace,
  redeemShortPairingCode,
  registerVault,
  uploadWorkspace,
  acknowledgeWorkspaceRevision,
  createFriendPushConnection,
  downloadFriendTimetable,
  registerFriendShare,
  revokeFriendShare,
  uploadFriendTimetable,
} from '../sync/relay';
import { createOwnedFriendShare, decodeFriendLink, encodeFriendLink } from '../sync/friends';
import {
  clearIgnoredRemote,
  clearPendingRemote,
  clearRelayPairing,
  clearCachedPairingCode,
  getDeviceId,
  getHistory,
  getIgnoredRemote,
  getLocalCurrent,
  getMetadata,
  getPendingRemote,
  getRelayPairing,
  getCachedPairingCode,
  getSettings,
  getProfiles,
  getActiveProfileId,
  patchMetadata,
  setIgnoredRemote,
  setLocalCurrent,
  setPendingRemote,
  setRelayPairing,
  setCachedPairingCode,
  setSettings,
  setProfiles,
  setActiveProfileId,
  getOwnedFriendShares,
  setOwnedFriendShares,
  getFriends,
  setFriends,
  getActiveFriendId,
  setActiveFriendId,
} from '../sync/storage';

async function currentPushStatus(): Promise<PushStatus> {
  const tabs = await webext.tabs.query({ url: ['https://nusmods.com/*', 'https://www.nusmods.com/*'] });
  const responses = await Promise.all(
    tabs.flatMap((tab) => tab.id === undefined
      ? []
      : [sendTabMessage<PushStatus>(tab.id, { type: 'GET_CONTENT_PUSH_STATUS' })]),
  );
  const statuses = responses.flatMap((response) => response.ok && response.data ? [response.data] : []);
  if (statuses.includes('live')) return 'live';
  if (statuses.includes('reconnecting')) return 'reconnecting';
  if (statuses.includes('connecting')) return 'connecting';
  return 'offline';
}

async function localWorkspace(updatedAt?: number, revision?: number): Promise<SyncedWorkspace | undefined> {
  const [timetable, profiles, activeProfileId, deviceId, metadata] = await Promise.all([
    getLocalCurrent(),
    getProfiles(),
    getActiveProfileId(),
    getDeviceId(),
    getMetadata(),
  ]);
  if (!timetable) return undefined;
  return {
    workspaceVersion: 1,
    revision: revision ?? metadata.lastKnownRevision ?? 0,
    updatedAt: updatedAt ?? Math.max(Date.now(), (metadata.lastSyncedAt ?? 0) + 1),
    deviceId,
    timetable,
    profiles,
    ...(activeProfileId ? { activeProfileId } : {}),
  };
}

function isNusmodsUrl(url: string | undefined, timetableOnly = true): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      ['nusmods.com', 'www.nusmods.com'].includes(parsed.hostname) &&
      (!timetableOnly || parsed.pathname.startsWith('/timetable'))
    );
  } catch {
    return false;
  }
}

async function activeNusmodsTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await webext.tabs.query({ active: true, currentWindow: true });
  return tabs.find((tab) => isNusmodsUrl(tab.url));
}

async function readActiveTimetable(): Promise<TimetableData | undefined> {
  const tab = await activeNusmodsTab();
  if (!tab?.id) return undefined;
  const response = await sendTabMessage<TimetableData>(tab.id, { type: 'READ_TIMETABLE' });
  return response.ok ? response.data : undefined;
}

async function resetSyncMetadata(lastPublishedHash?: string): Promise<void> {
  await patchMetadata({
    status: 'idle',
    lastPublishedHash,
    lastSyncedAt: undefined,
    payloadVersion: undefined,
    lastKnownRevision: undefined,
    lastPublishedRevision: undefined,
    revisionAcks: undefined,
    error: undefined,
  });
}

async function pairingState(): Promise<PairingState> {
  const pairing = await getRelayPairing();
  if (!pairing) return { paired: false, relayConfigured: isRelayConfigured() };
  const cached = await getCachedPairingCode();
  return {
    paired: true,
    relayConfigured: true,
    ...(cached && cached.expiresAt > Date.now()
      ? { pairingCode: cached.code, pairingCodeExpiresAt: cached.expiresAt }
      : {}),
  };
}

async function popupState(): Promise<PopupState> {
  const [metadata, current, pendingRemote, history, settings, tab, pairing, profiles, activeProfileId, pushStatus, ownedFriendShares, friends, activeFriendId] = await Promise.all([
    getMetadata(),
    getLocalCurrent(),
    getPendingRemote(),
    getHistory(),
    getSettings(),
    activeNusmodsTab(),
    pairingState(),
    getProfiles(),
    getActiveProfileId(),
    currentPushStatus(),
    getOwnedFriendShares(),
    getFriends(),
    getActiveFriendId(),
  ]);
  return {
    status: metadata.status,
    lastSyncedAt: metadata.lastSyncedAt,
    current,
    pendingRemote,
    history,
    settings,
    error: metadata.error,
    isNusmodsTab: Boolean(tab),
    pairing,
    profiles,
    activeProfileId,
    pushStatus: pairing.paired ? pushStatus : 'offline',
    ownedFriendShares,
    friends,
    activeFriendId,
  };
}

async function broadcastState(): Promise<void> {
  const state = await popupState();
  const tabs = await webext.tabs.query({ url: ['https://nusmods.com/*', 'https://www.nusmods.com/*'] });
  await Promise.all(
    tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [sendTabMessage(tab.id, { type: 'STATE_CHANGED', state }).catch(() => undefined)],
    ),
  );
}

async function setError(error: unknown): Promise<MessageResponse> {
  const message = errorMessage(error);
  errorLog(message, error);
  await patchMetadata({ status: 'error', error: message });
  await broadcastState();
  return { ok: false, error: message };
}

async function publish(local: SyncedTimetable): Promise<void> {
  const pairing = await getRelayPairing();
  if (!pairing) throw new Error('Set up sync with a pairing code first');
  const metadata = await getMetadata();
  const workspace = await localWorkspace(undefined, (metadata.lastKnownRevision ?? 0) + 1);
  if (!workspace) throw new Error('No timetable is available to sync');
  await patchMetadata({ status: 'saving', error: undefined });
  const result = await uploadWorkspace(pairing, workspace);
  if (result.status === 'stale') {
    const remote = await downloadWorkspace(pairing);
    if (remote && workspacesEqual(remote, workspace)) {
      await patchMetadata({
        status: 'synced',
        lastPublishedHash: workspaceHash(workspace),
        lastSyncedAt: remote.updatedAt,
        payloadVersion: 1,
        lastKnownRevision: remote.revision,
        error: undefined,
      });
    } else if (remote) {
      await handleRemoteChange(remote);
    }
    return;
  }
  await patchMetadata({
    status: 'synced',
    lastPublishedHash: workspaceHash(workspace),
    lastSyncedAt: workspace.updatedAt,
    payloadVersion: 1,
    lastKnownRevision: result.revision,
    lastPublishedRevision: result.revision,
    error: undefined,
  });
  debugLog('Saved encrypted timetable workspace');
}

async function captureTimetable(
  data: TimetableData,
  source: 'automatic' | 'manual',
): Promise<MessageResponse<SyncedTimetable>> {
  try {
    if (source === 'automatic' && await getActiveFriendId()) {
      return { ok: true, data: await getLocalCurrent() } as MessageResponse<SyncedTimetable>;
    }
    const [deviceId, existing, pendingRemote, settings, pairing, profiles, activeProfileId] = await Promise.all([
      getDeviceId(),
      getLocalCurrent(),
      getPendingRemote(),
      getSettings(),
      getRelayPairing(),
      getProfiles(),
      getActiveProfileId(),
    ]);
    if (existing && timetablesEqual(existing, data) && source === 'automatic') {
      return { ok: true, data: existing };
    }

    const local: SyncedTimetable = { ...data, deviceId, updatedAt: Date.now() };
    await setLocalCurrent(local);
    await saveSnapshot(local, source);
    const nextProfiles = activeProfileId && profiles.some((profile) => profile.id === activeProfileId)
      ? updateProfileTimetable(profiles, activeProfileId, local)
      : profiles;
    if (nextProfiles !== profiles) await setProfiles(nextProfiles);
    await publishOwnedShares(activeProfileId, local);

    const workspace: SyncedWorkspace = {
      workspaceVersion: 1,
      revision: (await getMetadata()).lastKnownRevision ?? 0,
      updatedAt: local.updatedAt,
      deviceId,
      timetable: local,
      profiles: nextProfiles,
      ...(activeProfileId ? { activeProfileId } : {}),
    };
    if (pendingRemote && !workspacesEqual(workspace, pendingRemote)) {
      await patchMetadata({
        status: local.modules.length > 0 ? 'conflict' : 'update-available',
        error: undefined,
      });
    } else if (pairing && (source === 'manual' || settings.autoSync)) {
      await clearPendingRemote();
      await publish(local);
    } else {
      await patchMetadata({ status: 'idle', error: undefined });
    }
    await broadcastState();
    return { ok: true, data: local };
  } catch (error) {
    return setError(error) as Promise<MessageResponse<SyncedTimetable>>;
  }
}

async function captureDetectedTimetable(
  detected: TimetableData,
  sender?: chrome.runtime.MessageSender,
): Promise<MessageResponse<SyncedTimetable>> {
  if (sender?.tab && sender.tab.active === false) {
    return { ok: true, data: await getLocalCurrent() } as MessageResponse<SyncedTimetable>;
  }
  if (sender?.tab?.id !== undefined) {
    const latest = await sendTabMessage<TimetableData>(sender.tab.id, { type: 'READ_TIMETABLE' });
    if (!latest.ok || !latest.data) {
      return { ok: true, data: await getLocalCurrent() } as MessageResponse<SyncedTimetable>;
    }
    if (!timetablesEqual(detected, latest.data)) debugLog('Skipped a stale timetable detection');
    return captureTimetable(latest.data, 'automatic');
  }
  return captureTimetable(detected, 'automatic');
}

async function syncNow(): Promise<MessageResponse<SyncedTimetable>> {
  if (await getActiveFriendId()) return { ok: false, error: 'Switch back to your timetable before syncing' };
  if (!(await getRelayPairing())) return { ok: false, error: 'Set up sync with a pairing code first' };
  const tab = await activeNusmodsTab();
  if (!tab?.id) return { ok: false, error: 'Open a NUSMods timetable tab first' };
  const response = await sendTabMessage<TimetableData>(tab.id, { type: 'READ_TIMETABLE' });
  if (!response.ok || !response.data) {
    return { ok: false, error: response.ok ? 'No timetable returned' : response.error };
  }
  return captureTimetable(response.data, 'manual');
}

async function saveCurrentBeforeApply(tabId: number): Promise<void> {
  const response = await sendTabMessage<TimetableData>(tabId, { type: 'READ_TIMETABLE' });
  if (!response.ok || !response.data) return;
  const current: SyncedTimetable = {
    ...response.data,
    deviceId: await getDeviceId(),
    updatedAt: Date.now(),
  };
  await setLocalCurrent(current);
  await saveSnapshot(current, 'before-restore');
  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (activeProfileId && profiles.some((profile) => profile.id === activeProfileId)) {
    await setProfiles(updateProfileTimetable(profiles, activeProfileId, current));
  }
}

async function applyWorkspaceToActiveTab(workspace: SyncedWorkspace): Promise<MessageResponse<unknown>> {
  if (await getActiveFriendId()) return { ok: false, error: 'Switch back to your timetable first' };
  const current = await getLocalCurrent();
  if (current && timetablesEqual(current, workspace.timetable)) {
    await setProfiles(workspace.profiles);
    await setActiveProfileId(workspace.activeProfileId);
    await setLocalCurrent(workspace.timetable);
    await clearPendingRemote();
    await clearIgnoredRemote();
    await patchMetadata({
      status: 'synced',
      lastPublishedHash: workspaceHash(workspace),
      lastSyncedAt: workspace.updatedAt,
      payloadVersion: 1,
      lastKnownRevision: workspace.revision,
      error: undefined,
    });
    await acknowledgeAppliedWorkspace(workspace);
    await broadcastState();
    return { ok: true };
  }
  const tab = await activeNusmodsTab();
  if (!tab?.id) return { ok: false, error: 'Open the matching NUSMods timetable first' };
  const [previousProfiles, previousActiveProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  await saveCurrentBeforeApply(tab.id);
  await setProfiles(workspace.profiles);
  await setActiveProfileId(workspace.activeProfileId);
  return sendTabMessage(tab.id, { type: 'APPLY_TIMETABLE', timetable: workspace.timetable }).then(async (response) => {
    if (response.ok) {
      await setLocalCurrent(workspace.timetable);
      await clearPendingRemote();
      await clearIgnoredRemote();
      await patchMetadata({
        status: 'synced',
        lastPublishedHash: workspaceHash(workspace),
        lastSyncedAt: workspace.updatedAt,
        payloadVersion: 1,
        lastKnownRevision: workspace.revision,
        error: undefined,
      });
      await acknowledgeAppliedWorkspace(workspace);
      await broadcastState();
    } else {
      await setProfiles(previousProfiles);
      await setActiveProfileId(previousActiveProfileId);
    }
    return response;
  });
}

async function acknowledgeAppliedWorkspace(workspace: SyncedWorkspace): Promise<void> {
  if (workspace.revision <= 0) return;
  const [pairing, deviceId] = await Promise.all([getRelayPairing(), getDeviceId()]);
  if (!pairing || workspace.deviceId === deviceId) return;
  try {
    await acknowledgeWorkspaceRevision(pairing, deviceId, workspace.revision);
  } catch (error) {
    debugLog('Revision acknowledgement deferred', error);
  }
}

async function recordRevisionAck(deviceId: string, revision: number): Promise<MessageResponse> {
  if (!/^device_[a-f0-9]{12}$/u.test(deviceId) || !Number.isSafeInteger(revision) || revision <= 0) {
    return { ok: false, error: 'Invalid revision acknowledgement' };
  }
  const ownDeviceId = await getDeviceId();
  if (deviceId === ownDeviceId) return { ok: true };
  const metadata = await getMetadata();
  if ((metadata.revisionAcks?.[deviceId] ?? 0) >= revision) return { ok: true };
  await patchMetadata({
    revisionAcks: { ...(metadata.revisionAcks ?? {}), [deviceId]: revision },
  });
  return { ok: true };
}

async function applyPendingRemote(): Promise<MessageResponse<unknown>> {
  const pending = await getPendingRemote();
  if (!pending) return { ok: false, error: 'No remote timetable is waiting' };
  return applyWorkspaceToActiveTab(pending);
}

async function restoreHistory(snapshotId: string): Promise<MessageResponse<unknown>> {
  try {
    const history = await getHistory();
    const snapshot = history.find((item) => item.id === snapshotId);
    if (!snapshot) return { ok: false, error: 'History snapshot was not found' };
    const tab = await activeNusmodsTab();
    if (!tab?.id) return { ok: false, error: 'Open a NUSMods timetable tab first' };
    const previousActiveProfileId = await getActiveProfileId();
    await saveCurrentBeforeApply(tab.id);
    await setActiveProfileId(undefined);
    const response = await sendTabMessage(tab.id, {
      type: 'APPLY_TIMETABLE',
      timetable: snapshot.timetable,
    });
    if (response.ok) {
      const restored: SyncedTimetable = {
        ...snapshot.timetable,
        deviceId: await getDeviceId(),
        updatedAt: Date.now(),
      };
      await setLocalCurrent(restored);
      await saveSnapshot(restored, 'restored');
      await publishCurrentIfPaired();
      await broadcastState();
    } else {
      await setActiveProfileId(previousActiveProfileId);
    }
    return response;
  } catch (error) {
    return setError(error);
  }
}

async function keepLocal(): Promise<MessageResponse<unknown>> {
  try {
    const current = await getLocalCurrent();
    if (!current) return { ok: false, error: 'No local timetable is available' };
    const updated: SyncedTimetable = {
      ...current,
      deviceId: await getDeviceId(),
      updatedAt: Date.now(),
    };
    await setLocalCurrent(updated);
    await clearPendingRemote();
    await clearIgnoredRemote();
    await publish(updated);
    await broadcastState();
    return { ok: true };
  } catch (error) {
    return setError(error);
  }
}

async function handleRemoteChange(remote: SyncedWorkspace): Promise<void> {
  const [local, deviceId, metadata, ignored, settings] = await Promise.all([
    localWorkspace(),
    getDeviceId(),
    getMetadata(),
    getIgnoredRemote(),
    getSettings(),
  ]);
  if (ignored?.deviceId === remote.deviceId && ignored.updatedAt === remote.updatedAt) return;
  const decision = classifyRemoteUpdate(local, remote, deviceId, metadata);
  if (decision.kind === 'ignore') {
    if (decision.reason === 'same-content' || decision.reason === 'same-device') {
      await patchMetadata({
        status: 'synced',
        lastPublishedHash: workspaceHash(remote),
        lastSyncedAt: remote.updatedAt,
        payloadVersion: 1,
        lastKnownRevision: remote.revision,
        ...(decision.reason === 'same-device' ? { lastPublishedRevision: remote.revision } : {}),
        error: undefined,
      });
      if (decision.reason === 'same-content') await acknowledgeAppliedWorkspace(remote);
      await broadcastState();
    }
    return;
  }
  await setPendingRemote(remote);
  await patchMetadata({
    status: decision.kind === 'conflict' ? 'conflict' : 'update-available',
    lastKnownRevision: Math.max(metadata.lastKnownRevision ?? 0, remote.revision),
    error: undefined,
  });
  debugLog('Remote encrypted update received');
  if (decision.kind === 'offer-remote' && settings.autoSync) {
    const response = await applyWorkspaceToActiveTab(remote);
    if (!response.ok) {
      debugLog('Automatic remote apply deferred', response.error);
      await broadcastState();
    }
    return;
  }
  await broadcastState();
}

async function pollRemote(): Promise<MessageResponse<SyncedWorkspace | undefined>> {
  try {
    const pairing = await getRelayPairing();
    if (!pairing) return { ok: true };
    const remote = await downloadWorkspace(pairing);
    if (remote) await handleRemoteChange(remote);
    return { ok: true, data: remote };
  } catch (error) {
    return setError(error) as Promise<MessageResponse<SyncedWorkspace | undefined>>;
  } finally {
    await scheduleNextPoll();
  }
}

async function pushConnection(): Promise<MessageResponse<PushConnection>> {
  try {
    const pairing = await getRelayPairing();
    if (!pairing) return { ok: false, error: 'Set up sync first' };
    return { ok: true, data: await createPushConnection(pairing, await getDeviceId()) };
  } catch (error) {
    debugLog('Instant sync connection deferred', error);
    return { ok: false, error: errorMessage(error) };
  }
}

async function createSyncPairing(): Promise<MessageResponse<PairingState>> {
  try {
    const pairing = createPairing();
    await registerVault(pairing);
    await setRelayPairing(pairing);
    await clearCachedPairingCode();
    await clearPendingRemote();
    await clearIgnoredRemote();
    await resetSyncMetadata();
    try {
      await setCachedPairingCode(await createShortPairingCode(pairing));
    } catch (error) {
      debugLog('Initial pairing code could not be created', error);
    }
    const local = await getLocalCurrent();
    if (local) await publish(local);
    await scheduleNextPoll();
    await broadcastState();
    return { ok: true, data: await pairingState() };
  } catch (error) {
    return setError(error) as Promise<MessageResponse<PairingState>>;
  }
}

async function joinSyncPairing(pairingCode: string): Promise<MessageResponse<PairingState>> {
  try {
    const pairing = await redeemShortPairingCode(pairingCode);
    const remote = await downloadWorkspace(pairing);
    const localBeforeJoin = await localWorkspace();
    const localIsEmpty = Boolean(
      localBeforeJoin &&
      localBeforeJoin.timetable.modules.length === 0 &&
      localBeforeJoin.profiles.length === 0,
    );
    await setRelayPairing(pairing);
    await clearCachedPairingCode();
    await clearPendingRemote();
    await clearIgnoredRemote();
    await resetSyncMetadata(localIsEmpty && localBeforeJoin ? workspaceHash(localBeforeJoin) : undefined);
    if (remote) await handleRemoteChange(remote);
    else if (localBeforeJoin) await publish(localBeforeJoin.timetable);
    await scheduleNextPoll();
    await broadcastState();
    return { ok: true, data: await pairingState() };
  } catch (error) {
    return setError(error) as Promise<MessageResponse<PairingState>>;
  }
}

async function disconnectPairing(): Promise<MessageResponse> {
  await clearRelayPairing();
  await clearCachedPairingCode();
  await clearPendingRemote();
  await clearIgnoredRemote();
  await webext.alarms.clear(RELAY_POLL_ALARM);
  await resetSyncMetadata();
  await broadcastState();
  return { ok: true };
}

async function refreshPairingCode(): Promise<MessageResponse<PairingState>> {
  try {
    const pairing = await getRelayPairing();
    if (!pairing) return { ok: false, error: 'Set up sync first' };
    await setCachedPairingCode(await createShortPairingCode(pairing));
    await broadcastState();
    return { ok: true, data: await pairingState() };
  } catch (error) {
    return setError(error) as Promise<MessageResponse<PairingState>>;
  }
}

async function publishCurrentIfPaired(): Promise<void> {
  const [current, pairing] = await Promise.all([getLocalCurrent(), getRelayPairing()]);
  if (current && pairing) await publish(current);
}

async function saveCurrentProfile(name?: string): Promise<MessageResponse<unknown>> {
  try {
    const page = await readActiveTimetable();
    const [cached, profiles, deviceId] = await Promise.all([getLocalCurrent(), getProfiles(), getDeviceId()]);
    const current = page ? { ...page, deviceId, updatedAt: Date.now() } : cached;
    if (!current) return { ok: false, error: 'Open a NUSMods timetable before saving a tab' };
    await setLocalCurrent(current);
    const next = createProfile(profiles, current, name ?? nextProfileName(profiles, current.semester));
    const created = next.at(-1);
    await setProfiles(next);
    await setActiveProfileId(created?.id);
    await publishCurrentIfPaired();
    await broadcastState();
    return { ok: true, data: created };
  } catch (error) {
    return setError(error);
  }
}

async function addProfileTab(): Promise<MessageResponse<unknown>> {
  try {
    if (await getActiveFriendId()) return { ok: false, error: 'Switch back to your timetable first' };
    const tab = await activeNusmodsTab();
    if (!tab?.id) return { ok: false, error: 'Open a NUSMods timetable tab first' };
    const response = await sendTabMessage<TimetableData>(tab.id, { type: 'READ_TIMETABLE' });
    if (!response.ok || !response.data) {
      return { ok: false, error: response.ok ? 'No timetable returned' : response.error };
    }
    const [deviceId, profiles, activeProfileId] = await Promise.all([
      getDeviceId(),
      getProfiles(),
      getActiveProfileId(),
    ]);
    const current: SyncedTimetable = { ...response.data, deviceId, updatedAt: Date.now() };
    await setLocalCurrent(current);
    await saveSnapshot(current, 'before-restore');
    const created = createBlankProfileTab(profiles, current, activeProfileId);
    await setProfiles(created.profiles);
    await setActiveProfileId(created.profile.id);
    const apply = await sendTabMessage(tab.id, { type: 'APPLY_TIMETABLE', timetable: created.profile.timetable });
    if (!apply.ok) {
      await setProfiles(profiles);
      await setActiveProfileId(activeProfileId);
      return apply;
    }
    await setLocalCurrent(created.profile.timetable);
    await publishCurrentIfPaired();
    await broadcastState();
    return { ok: true, data: created.profile };
  } catch (error) {
    return setError(error);
  }
}

async function activateProfile(profileId?: string): Promise<MessageResponse<unknown>> {
  try {
    if (!profileId) {
      await setActiveProfileId(undefined);
      await broadcastState();
      return { ok: true };
    }
    if (!(await getProfiles()).some((item) => item.id === profileId)) {
      return { ok: false, error: 'Saved timetable was not found' };
    }
    const previous = await getActiveProfileId();
    const viewingFriend = Boolean(await getActiveFriendId());
    const tab = await activeNusmodsTab();
    if (!tab?.id) return { ok: false, error: 'Open a NUSMods timetable tab first' };
    if (!viewingFriend) await saveCurrentBeforeApply(tab.id);
    const profile = (await getProfiles()).find((item) => item.id === profileId);
    if (!profile) return { ok: false, error: 'Saved timetable was not found' };
    await setActiveProfileId(profileId);
    const response = await sendTabMessage(tab.id, {
      type: 'APPLY_TIMETABLE',
      timetable: profile.timetable,
    });
    if (!response.ok) await setActiveProfileId(previous);
    else {
      await setActiveFriendId(undefined);
      await setLocalCurrent(profile.timetable);
      await publishCurrentIfPaired();
    }
    await broadcastState();
    return response;
  } catch (error) {
    return setError(error);
  }
}

async function publishOwnedShares(profileId: string | undefined, timetable: SyncedTimetable): Promise<void> {
  const shares = await getOwnedFriendShares();
  await Promise.all(
    shares.filter((share) => share.profileId === profileId).map((share) =>
      uploadFriendTimetable(share, timetable).catch((error) => debugLog('Friend share update deferred', error)),
    ),
  );
}

async function createFriendShare(name?: string): Promise<MessageResponse<{ link: string }>> {
  try {
    const page = await readActiveTimetable();
    const [cached, activeProfileId, shares, deviceId] = await Promise.all([
      getLocalCurrent(), getActiveProfileId(), getOwnedFriendShares(), getDeviceId(),
    ]);
    const current = page ? { ...page, deviceId, updatedAt: Date.now() } : cached;
    if (!current) return { ok: false, error: 'Open a NUSMods timetable first' };
    if (page) await setLocalCurrent(current);
    if (shares.length >= 10) return { ok: false, error: 'You can share up to 10 timetables' };
    const profileName = (await getProfiles()).find((profile) => profile.id === activeProfileId)?.name;
    const share = createOwnedFriendShare(name ?? profileName ?? 'My timetable', activeProfileId);
    await registerFriendShare(share);
    await uploadFriendTimetable(share, current);
    await setOwnedFriendShares([...shares, share]);
    await broadcastState();
    return { ok: true, data: { link: encodeFriendLink(share.access) } };
  } catch (error) {
    return setError(error) as Promise<MessageResponse<{ link: string }>>;
  }
}

async function removeOwnedFriendShare(shareId: string): Promise<MessageResponse> {
  try {
    const shares = await getOwnedFriendShares();
    const share = shares.find((item) => item.id === shareId);
    if (!share) return { ok: false, error: 'Shared timetable was not found' };
    await revokeFriendShare(share);
    await setOwnedFriendShares(shares.filter((item) => item.id !== shareId));
    await broadcastState();
    return { ok: true };
  } catch (error) { return setError(error); }
}

async function addFriend(shareLink: string, name?: string): Promise<MessageResponse> {
  try {
    const access = decodeFriendLink(shareLink);
    const friends = await getFriends();
    if (friends.some((friend) => friend.access.shareId === access.shareId)) {
      return { ok: false, error: 'This friend timetable is already added' };
    }
    if (friends.length >= 10) return { ok: false, error: 'You can follow up to 10 friend timetables' };
    const timetable = await downloadFriendTimetable(access);
    const friend = {
      id: crypto.randomUUID(),
      name: name?.trim().slice(0, 40) || `Friend ${friends.length + 1}`,
      access,
      ...(timetable ? { timetable, updatedAt: timetable.updatedAt } : {}),
      enabled: true,
    };
    await setFriends([...friends, friend]);
    await scheduleNextPoll();
    await broadcastState();
    return { ok: true };
  } catch (error) { return setError(error); }
}

async function pollFriends(): Promise<MessageResponse> {
  const friends = await getFriends();
  const activeFriendId = await getActiveFriendId();
  let activeUpdate: SyncedTimetable | undefined;
  const next = await Promise.all(friends.map(async (friend) => {
    try {
      const timetable = await downloadFriendTimetable(friend.access);
      if (!timetable || timetable.updatedAt === friend.updatedAt) return friend;
      if (friend.id === activeFriendId) activeUpdate = timetable;
      return { ...friend, timetable, updatedAt: timetable.updatedAt };
    } catch (error) {
      debugLog(`Could not refresh ${friend.name}`, error);
      return friend;
    }
  }));
  await setFriends(next);
  if (activeUpdate) {
    const tab = await activeNusmodsTab();
    if (tab?.id) await sendTabMessage(tab.id, { type: 'APPLY_TIMETABLE', timetable: activeUpdate });
  }
  await broadcastState();
  return { ok: true };
}

async function viewFriend(friendId?: string): Promise<MessageResponse<unknown>> {
  try {
    const tab = await activeNusmodsTab();
    if (!tab?.id) return { ok: false, error: 'Open a NUSMods timetable first' };
    if (!friendId) {
      const own = await getLocalCurrent();
      if (!own) return { ok: false, error: 'Your timetable is not available' };
      const response = await sendTabMessage(tab.id, { type: 'APPLY_TIMETABLE', timetable: own });
      if (response.ok) await setActiveFriendId(undefined);
      await broadcastState();
      return response;
    }
    const friend = (await getFriends()).find((item) => item.id === friendId);
    if (!friend?.timetable) return { ok: false, error: 'Friend timetable is not available yet' };
    await setActiveFriendId(friend.id);
    const response = await sendTabMessage(tab.id, { type: 'APPLY_TIMETABLE', timetable: friend.timetable });
    if (!response.ok) await setActiveFriendId(undefined);
    await broadcastState();
    return response;
  } catch (error) { return setError(error); }
}

async function friendPushConnections(): Promise<MessageResponse<FriendPushConnection[]>> {
  try {
    const [friends, deviceId] = await Promise.all([getFriends(), getDeviceId()]);
    const connections = await Promise.all(
      friends.filter((friend) => friend.enabled).map((friend) => createFriendPushConnection(friend.id, friend.access, deviceId)),
    );
    return { ok: true, data: connections };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

async function renameSavedProfile(profileId: string, name: string): Promise<MessageResponse> {
  try {
    await setProfiles(renameProfile(await getProfiles(), profileId, name));
    await publishCurrentIfPaired();
    await broadcastState();
    return { ok: true };
  } catch (error) {
    return setError(error);
  }
}

async function duplicateSavedProfile(profileId: string): Promise<MessageResponse> {
  try {
    const next = duplicateProfile(await getProfiles(), profileId);
    await setProfiles(next);
    await setActiveProfileId(next.at(-1)?.id);
    await publishCurrentIfPaired();
    await broadcastState();
    return { ok: true };
  } catch (error) {
    return setError(error);
  }
}

async function deleteSavedProfile(profileId: string): Promise<MessageResponse> {
  try {
    const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
    await setProfiles(deleteProfile(profiles, profileId));
    if (activeProfileId === profileId) await setActiveProfileId(undefined);
    await publishCurrentIfPaired();
    await broadcastState();
    return { ok: true };
  } catch (error) {
    return setError(error);
  }
}

async function reorderSavedProfiles(profileIds: string[]): Promise<MessageResponse> {
  try {
    await setProfiles(reorderProfiles(await getProfiles(), profileIds));
    await publishCurrentIfPaired();
    await broadcastState();
    return { ok: true };
  } catch (error) {
    return setError(error);
  }
}

async function scheduleNextPoll(): Promise<void> {
  const [pairing, friends] = await Promise.all([getRelayPairing(), getFriends()]);
  if (!pairing && friends.length === 0) {
    await webext.alarms.clear(RELAY_POLL_ALARM);
    return;
  }
  const tabs = await webext.tabs.query({ url: ['https://nusmods.com/*', 'https://www.nusmods.com/*'] });
  const delayInMinutes = tabs.length > 0 ? ACTIVE_POLL_MINUTES : IDLE_POLL_MINUTES;
  await webext.alarms.create(RELAY_POLL_ALARM, { delayInMinutes });
}

async function handleMessage(
  message: RuntimeMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<MessageResponse<unknown>> {
  switch (message.type) {
    case 'TIMETABLE_DETECTED':
      return captureDetectedTimetable(message.timetable, sender);
    case 'GET_POPUP_STATE':
    case 'GET_PAGE_STATE':
      return { ok: true, data: await popupState() };
    case 'SYNC_NOW':
      return syncNow();
    case 'POLL_REMOTE':
      return pollRemote();
    case 'GET_PUSH_CONNECTION': {
      return pushConnection();
    }
    case 'GET_FRIEND_PUSH_CONNECTIONS':
      return friendPushConnections();
    case 'CREATE_FRIEND_SHARE':
      return createFriendShare(message.name);
    case 'REVOKE_FRIEND_SHARE':
      return removeOwnedFriendShare(message.shareId);
    case 'ADD_FRIEND':
      return addFriend(message.shareLink, message.name);
    case 'REMOVE_FRIEND': {
      const friends = await getFriends();
      if (await getActiveFriendId() === message.friendId) {
        const response = await viewFriend(undefined);
        if (!response.ok) return response;
      }
      await setFriends(friends.filter((friend) => friend.id !== message.friendId));
      await broadcastState();
      return { ok: true };
    }
    case 'RENAME_FRIEND': {
      const name = message.name.trim().slice(0, 40);
      if (!name) return { ok: false, error: 'Enter a friend name' };
      await setFriends((await getFriends()).map((friend) => friend.id === message.friendId ? { ...friend, name } : friend));
      await broadcastState();
      return { ok: true };
    }
    case 'SET_FRIEND_ENABLED': {
      await setFriends((await getFriends()).map((friend) =>
        friend.id === message.friendId ? { ...friend, enabled: message.enabled } : friend,
      ));
      await broadcastState();
      if (message.enabled) void enqueueMutation(() => pollFriends());
      return { ok: true };
    }
    case 'VIEW_FRIEND':
      return viewFriend(message.friendId);
    case 'POLL_FRIENDS':
      return pollFriends();
    case 'SET_PUSH_STATUS': {
      await broadcastState();
      return { ok: true };
    }
    case 'RECORD_REVISION_ACK':
      return recordRevisionAck(message.deviceId, message.revision);
    case 'CREATE_PAIRING':
      return createSyncPairing();
    case 'CREATE_PAIRING_CODE':
      return refreshPairingCode();
    case 'JOIN_PAIRING':
      return joinSyncPairing(message.pairingCode);
    case 'DISCONNECT_PAIRING':
      return disconnectPairing();
    case 'SAVE_PROFILE':
      return saveCurrentProfile(message.name);
    case 'ADD_PROFILE_TAB':
      return addProfileTab();
    case 'ACTIVATE_PROFILE':
      return activateProfile(message.profileId);
    case 'RENAME_PROFILE':
      return renameSavedProfile(message.profileId, message.name);
    case 'DUPLICATE_PROFILE':
      return duplicateSavedProfile(message.profileId);
    case 'DELETE_PROFILE':
      return deleteSavedProfile(message.profileId);
    case 'REORDER_PROFILES':
      return reorderSavedProfiles(message.profileIds);
    case 'APPLY_PENDING_REMOTE':
      return applyPendingRemote();
    case 'IGNORE_PENDING_REMOTE': {
      const pending = await getPendingRemote();
      if (pending) await setIgnoredRemote({ deviceId: pending.deviceId, updatedAt: pending.updatedAt });
      await clearPendingRemote();
      const [current, metadata] = await Promise.all([localWorkspace(), getMetadata()]);
      const isPublished = Boolean(current && metadata.lastPublishedHash === workspaceHash(current));
      await patchMetadata({ status: isPublished ? 'synced' : 'idle', error: undefined });
      await broadcastState();
      return { ok: true };
    }
    case 'KEEP_LOCAL':
      return keepLocal();
    case 'RESTORE_HISTORY':
      return restoreHistory(message.snapshotId);
    case 'SET_SETTINGS': {
      const settings: ExtensionSettings = { ...(await getSettings()), ...message.settings };
      await setSettings(settings);
      await broadcastState();
      return { ok: true, data: settings };
    }
    default:
      return { ok: false, error: 'Unsupported message' };
  }
}

const immediateMessages = new Set<RuntimeMessage['type']>([
  'GET_POPUP_STATE',
  'GET_PAGE_STATE',
  'GET_PUSH_CONNECTION',
  'GET_FRIEND_PUSH_CONNECTIONS',
  'SET_PUSH_STATUS',
]);
let mutationQueue: Promise<void> = Promise.resolve();

function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function dispatchMessage(
  message: RuntimeMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<MessageResponse<unknown>> {
  return immediateMessages.has(message.type)
    ? handleMessage(message, sender)
    : enqueueMutation(() => handleMessage(message, sender));
}

webext.runtime.onInstalled.addListener(() => {
  void getDeviceId().then(scheduleNextPoll);
});

webext.runtime.onStartup.addListener(() => {
  void enqueueMutation(initializeSync);
});

webext.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void dispatchMessage(message, sender)
    .then(sendResponse)
    .catch(async (error: unknown) => sendResponse(await setError(error)));
  return true;
});

webext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RELAY_POLL_ALARM) {
    void enqueueMutation(pollRemote);
    void enqueueMutation(pollFriends);
  }
});

webext.tabs.onRemoved.addListener(() => void broadcastState());

async function initializeSync(): Promise<void> {
  const [pairing, current, metadata] = await Promise.all([
    getRelayPairing(),
    getLocalCurrent(),
    getMetadata(),
  ]);
  if (pairing && current && metadata.payloadVersion !== 1) {
    try {
      await publish(current);
      await scheduleNextPoll();
      return;
    } catch (error) {
      await setError(error);
    }
  }
  await Promise.all([pollRemote(), pollFriends()]);
}

void initializeSync();
