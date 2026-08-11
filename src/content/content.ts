import { errorMessage } from '../shared/errors';
import { debugLog } from '../shared/log';
import { sendRuntimeMessage } from '../shared/messages';
import type { FriendPushConnection, MessageResponse, PopupState, PushConnection, RuntimeMessage, TimetableData } from '../shared/types';
import { applyTimetable } from '../nusmods/applyTimetable';
import { startAutoImport } from '../nusmods/autoImport';
import { readTimetable } from '../nusmods/readTimetable';
import { watchTimetable } from '../nusmods/watchTimetable';
import { renderIndicator } from './indicator';
import { evaluateApplyCapture, type PendingApply } from './applyCapture';
import { LatestAsyncQueue } from './latestQueue';
import { webext } from '../shared/webext';
import { timetablesEqual } from '../sync/comparison';

let stopWatching: (() => void) | undefined;
let previousTimetableRoute: boolean | undefined;
let pushSocket: WebSocket | undefined;
let pushReconnectTimer: number | undefined;
let pushRetry = 0;
let pushPaired = false;
let reportedPushStatus: PopupState['pushStatus'] | undefined;
let pushRequesting = false;
const friendSockets = new Map<string, WebSocket>();
let friendPushRequesting = false;
let friendReconnectTimer: number | undefined;
let pendingApply: PendingApply | undefined;
let remotePollTimer: number | undefined;

const timetableCaptureQueue = new LatestAsyncQueue<TimetableData>(
  (timetable) => sendRuntimeMessage({ type: 'TIMETABLE_DETECTED', timetable }),
  (error) => debugLog('Timetable update could not be sent', error),
);
const remotePollQueue = new LatestAsyncQueue<void>(
  () => sendRuntimeMessage({ type: 'POLL_REMOTE' }),
  (error) => debugLog('Remote update check failed', error),
);

function requestRemotePoll(delayMs = 0): void {
  if (remotePollTimer !== undefined) window.clearTimeout(remotePollTimer);
  remotePollTimer = window.setTimeout(() => {
    remotePollTimer = undefined;
    remotePollQueue.push(undefined);
  }, delayMs);
}

async function waitForAppliedTimetable(target: TimetableData, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (timetablesEqual(readTimetable(), target)) return;
    } catch {
      // NUSMods temporarily uses its share route while importing.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  throw new Error('NUSMods did not finish applying the timetable. Try again.');
}

startAutoImport();

function refreshPageUi(): void {
  void sendRuntimeMessage<PopupState>({ type: 'GET_PAGE_STATE' }).then((response) => {
    if (response.ok && response.data) {
      renderIndicator(response.data);
      updatePushConnection(response.data.pairing.paired);
      updateFriendConnections(response.data.friends.filter((friend) => friend.enabled).map((friend) => friend.id));
    }
  });
}

function updateFriendConnections(friendIds: string[]): void {
  const wanted = new Set(friendIds);
  for (const [id, socket] of friendSockets) {
    if (!wanted.has(id) || !window.location.pathname.startsWith('/timetable')) {
      friendSockets.delete(id);
      socket.close(1000, 'Not needed');
    }
  }
  if (wanted.size > 0 && window.location.pathname.startsWith('/timetable')) void connectFriendSockets();
}

function scheduleFriendReconnect(): void {
  if (friendReconnectTimer !== undefined || !window.location.pathname.startsWith('/timetable')) return;
  friendReconnectTimer = window.setTimeout(() => {
    friendReconnectTimer = undefined;
    void connectFriendSockets();
  }, 3_000);
}

async function connectFriendSockets(): Promise<void> {
  if (friendPushRequesting || !window.location.pathname.startsWith('/timetable')) return;
  friendPushRequesting = true;
  const response = await sendRuntimeMessage<FriendPushConnection[]>({ type: 'GET_FRIEND_PUSH_CONNECTIONS' });
  friendPushRequesting = false;
  if (!response.ok || !response.data) {
    scheduleFriendReconnect();
    return;
  }
  for (const connection of response.data) {
    const existing = friendSockets.get(connection.friendId);
    if (existing && existing.readyState < WebSocket.CLOSING) continue;
    const socket = new WebSocket(connection.url);
    friendSockets.set(connection.friendId, socket);
    socket.addEventListener('open', () => void sendRuntimeMessage({ type: 'POLL_FRIENDS' }));
    socket.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      try {
        if ((JSON.parse(String(event.data)) as { type?: unknown }).type === 'updated') {
          void sendRuntimeMessage({ type: 'POLL_FRIENDS' });
        }
      } catch { /* Ignore non-update messages. */ }
    });
    socket.addEventListener('close', () => {
      if (friendSockets.get(connection.friendId) === socket) friendSockets.delete(connection.friendId);
      scheduleFriendReconnect();
    });
    socket.addEventListener('error', () => socket.close());
  }
}

function stopPushConnection(): void {
  if (pushReconnectTimer !== undefined) window.clearTimeout(pushReconnectTimer);
  pushReconnectTimer = undefined;
  if (remotePollTimer !== undefined) window.clearTimeout(remotePollTimer);
  remotePollTimer = undefined;
  const socket = pushSocket;
  pushSocket = undefined;
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Not needed');
  reportPushStatus('offline');
}

function reportPushStatus(status: PopupState['pushStatus']): void {
  if (reportedPushStatus === status) return;
  reportedPushStatus = status;
  void sendRuntimeMessage({ type: 'SET_PUSH_STATUS', status });
}

function schedulePushReconnect(): void {
  if (!pushPaired || !window.location.pathname.startsWith('/timetable') || pushReconnectTimer !== undefined) return;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(pushRetry, 5));
  pushRetry += 1;
  reportPushStatus('reconnecting');
  pushReconnectTimer = window.setTimeout(() => {
    pushReconnectTimer = undefined;
    void connectPush();
  }, delay);
}

async function connectPush(): Promise<void> {
  if (
    !pushPaired || !window.location.pathname.startsWith('/timetable') ||
    pushRequesting || pushReconnectTimer !== undefined ||
    pushSocket?.readyState === WebSocket.OPEN || pushSocket?.readyState === WebSocket.CONNECTING
  ) return;
  pushRequesting = true;
  reportPushStatus(pushRetry > 0 ? 'reconnecting' : 'connecting');
  const response = await sendRuntimeMessage<PushConnection>({ type: 'GET_PUSH_CONNECTION' });
  pushRequesting = false;
  if (!response.ok || !response.data || !pushPaired) {
    schedulePushReconnect();
    return;
  }
  const socket = new WebSocket(response.data.url);
  pushSocket = socket;
  socket.addEventListener('open', () => {
    pushRetry = 0;
    reportPushStatus('live');
    requestRemotePoll();
  });
  socket.addEventListener('message', (event) => {
    if (event.data === 'pong') return;
    try {
      const message = JSON.parse(String(event.data)) as { type?: unknown; revision?: unknown; deviceId?: unknown };
      if (message.type === 'updated') requestRemotePoll(75);
      if (
        message.type === 'acknowledged' &&
        Number.isSafeInteger(message.revision) && Number(message.revision) > 0 &&
        typeof message.deviceId === 'string'
      ) {
        void sendRuntimeMessage({
          type: 'RECORD_REVISION_ACK',
          revision: Number(message.revision),
          deviceId: message.deviceId,
        });
      }
    } catch {
      // Ignore messages that are not relay update notices.
    }
  });
  socket.addEventListener('close', () => {
    if (pushSocket === socket) pushSocket = undefined;
    schedulePushReconnect();
  });
  socket.addEventListener('error', () => socket.close());
}

function updatePushConnection(paired: boolean): void {
  pushPaired = paired;
  if (paired && window.location.pathname.startsWith('/timetable')) void connectPush();
  else stopPushConnection();
}

function updateWatcher(): void {
  const onTimetable = window.location.pathname.startsWith('/timetable');
  if (previousTimetableRoute !== onTimetable) {
    previousTimetableRoute = onTimetable;
    refreshPageUi();
  }
  if (onTimetable && !stopWatching) {
    stopWatching = watchTimetable((timetable) => {
      if (document.visibilityState !== 'visible') return;
      const capture = evaluateApplyCapture(pendingApply, timetable);
      pendingApply = capture.pending;
      if (capture.suppress) return;
      timetableCaptureQueue.push(timetable);
    });
    requestRemotePoll();
    if (pushPaired) void connectPush();
    void connectFriendSockets();
  } else if (!onTimetable && stopWatching) {
    stopWatching();
    stopWatching = undefined;
    stopPushConnection();
    updateFriendConnections([]);
  }
}

updateWatcher();
window.setInterval(updateWatcher, 1_000);

refreshPageUi();

const friendHash = new URLSearchParams(window.location.hash.slice(1));
const friendLink = friendHash.get('nmsf') ?? friendHash.get('nusmods-sync-friend');
if (friendLink) {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  void sendRuntimeMessage({ type: 'ADD_FRIEND', shareLink: friendLink });
}

webext.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  const respond = async (): Promise<MessageResponse<TimetableData | PopupState['pushStatus'] | undefined>> => {
    try {
      if (message.type === 'READ_TIMETABLE') return { ok: true, data: readTimetable() };
      if (message.type === 'GET_CONTENT_PUSH_STATUS') {
        return { ok: true, data: reportedPushStatus ?? 'offline' };
      }
      if (message.type === 'STATE_CHANGED') {
        renderIndicator(message.state);
        updatePushConnection(message.state.pairing.paired);
        updateFriendConnections(message.state.friends.filter((friend) => friend.enabled).map((friend) => friend.id));
        return { ok: true };
      }
      if (message.type === 'APPLY_TIMETABLE') {
        const current = readTimetable();
        if (timetablesEqual(current, message.timetable)) return { ok: true };
        if (
          current.semester !== message.timetable.semester &&
          !window.confirm(
            `This will open Semester ${message.timetable.semester}, while you are viewing Semester ${current.semester}. Continue?`,
          )
        ) {
          return { ok: false, error: 'Restore cancelled' };
        }
        pendingApply = { target: message.timetable, expiresAt: Date.now() + 20_000 };
        try {
          applyTimetable(message.timetable, current);
          await waitForAppliedTimetable(message.timetable);
          pendingApply = undefined;
          return { ok: true };
        } catch (error) {
          pendingApply = undefined;
          throw error;
        }
      }
      return { ok: false, error: 'Unsupported content-script message' };
    } catch (error) {
      debugLog('Page integration error', error);
      return { ok: false, error: errorMessage(error) };
    }
  };
  void respond().then(sendResponse);
  return true;
});
