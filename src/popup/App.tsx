import { useCallback, useEffect, useState } from 'react';

import { sendRuntimeMessage } from '../shared/messages';
import type { MessageResponse, PopupState, RuntimeMessage, SyncStatus } from '../shared/types';
import { webext } from '../shared/webext';
import { encodeFriendLink } from '../sync/friends';
import { buildShareUrl } from '../nusmods/applyTimetable';

const statusLabels: Record<SyncStatus, string> = {
  idle: 'Ready',
  saving: 'Saving…',
  synced: 'Synced',
  'update-available': 'Update available',
  conflict: 'Conflict',
  error: 'Sync failed',
};

function formatAcademicYear(value: string): string {
  const match = value.match(/(\d{4})\D+(\d{2,4})/);
  if (!match) return `AY${value}`;
  return `AY${match[1]}/${match[2].slice(-2)}`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return time;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' }) + `, ${time}`;
}

export function App() {
  const [state, setState] = useState<PopupState>();
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [pairingCode, setPairingCode] = useState('');
  const [pairingExpanded, setPairingExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [friendLink, setFriendLink] = useState('');
  const [shareCopied, setShareCopied] = useState<string>();
  const [profileLinkCopied, setProfileLinkCopied] = useState<string>();

  const refresh = useCallback(async () => {
    const response = await sendRuntimeMessage<PopupState>({ type: 'GET_POPUP_STATE' });
    if (response.ok && response.data) setState(response.data);
    else if (!response.ok) setActionError(response.error);
  }, []);

  useEffect(() => {
    void refresh();
    let refreshTimer: number | undefined;
    const listener = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 50);
    };
    webext.storage.onChanged.addListener(listener);
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      webext.storage.onChanged.removeListener(listener);
    };
  }, [refresh]);

  useEffect(() => {
    const expiresAt = state?.pairing.paired ? state.pairing.pairingCodeExpiresAt : undefined;
    if (!expiresAt) return;
    const timeout = window.setTimeout(() => void refresh(), Math.max(0, expiresAt - Date.now()) + 100);
    return () => window.clearTimeout(timeout);
  }, [refresh, state?.pairing]);

  const currentPairingCode = state?.pairing.paired ? state.pairing.pairingCode : undefined;
  useEffect(() => {
    if (currentPairingCode) setPairingExpanded(true);
  }, [currentPairingCode]);

  const act = async (message: RuntimeMessage) => {
    setBusy(true);
    setActionError(undefined);
    const response: MessageResponse = await sendRuntimeMessage(message);
    if (!response.ok) setActionError(response.error);
    else if (message.type === 'CREATE_PAIRING' || message.type === 'CREATE_PAIRING_CODE') setPairingExpanded(true);
    await refresh();
    setBusy(false);
  };

  if (!state) return <main className="shell loading">Loading NUSMods Sync…</main>;
  const visibleHistory = showAll ? state.history : state.history.slice(0, 4);
  const current = state.current;
  const paired = state.pairing.paired;

  const copyPairingCode = async () => {
    if (!state.pairing.paired || !state.pairing.pairingCode) return;
    await navigator.clipboard.writeText(state.pairing.pairingCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const createShare = async () => {
    setBusy(true);
    setActionError(undefined);
    const response = await sendRuntimeMessage<{ link: string }>({ type: 'CREATE_FRIEND_SHARE' });
    if (response.ok && response.data) {
      await navigator.clipboard.writeText(response.data.link);
      setShareCopied('current');
      window.setTimeout(() => setShareCopied(undefined), 1_500);
    } else if (!response.ok) setActionError(response.error);
    await refresh();
    setBusy(false);
  };

  const shareCurrent = async () => {
    const existing = state?.ownedFriendShares.find((share) => share.profileId === state.activeProfileId);
    if (existing) await copyShare('current', encodeFriendLink(existing.access));
    else await createShare();
  };

  const addFriend = async () => {
    if (!friendLink.trim()) return;
    await act({ type: 'ADD_FRIEND', shareLink: friendLink });
    setFriendLink('');
  };

  const copyShare = async (id: string, link: string) => {
    await navigator.clipboard.writeText(link);
    setShareCopied(id);
    window.setTimeout(() => setShareCopied(undefined), 1_500);
  };

  const copyProfileShareLink = async (profileId: string) => {
    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(buildShareUrl(profile.timetable));
      setProfileLinkCopied(profileId);
      window.setTimeout(() => setProfileLinkCopied(undefined), 1_500);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not copy the NUSMods share link');
    }
  };

  return (
    <main className="shell">
      <header className="topbar">
        <h1>NUSMods Sync</h1>
          <div className={`status status-${state.status}`}>
          <span className="statusDot" /> {statusLabels[state.status]}
          {paired && <span className={`connection connection-${state.pushStatus}`}>· {{
            live: 'Live',
            connecting: 'Connecting',
            reconnecting: 'Reconnecting',
            offline: 'Offline',
          }[state.pushStatus]}</span>}
        </div>
      </header>

      {!state.pairing.relayConfigured && (
        <section className="notice danger">
          <strong>Relay is not configured</strong>
          <p>Build the extension with your deployed Cloudflare Worker URL.</p>
        </section>
      )}

      {!paired && state.pairing.relayConfigured && (
        <section className="pairingCard">
          <h2>Pair devices</h2>
          <button className="primary syncButton" disabled={busy} onClick={() => void act({ type: 'CREATE_PAIRING' })}>
            Start on this device
          </button>
          <div className="divider"><span>Pair with a code</span></div>
          <input
            className="pairingInput"
            value={pairingCode}
            placeholder="XXXX"
            aria-label="Pairing code"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={4}
            spellCheck={false}
            onChange={(event) => setPairingCode(
              event.target.value.toUpperCase().replace(/O/gu, '0').replace(/[IL]/gu, '1').replace(/[^0-9A-HJKMNP-TV-Z]/gu, '').slice(0, 4),
            )}
          />
          <button
            className="ghost joinButton"
            disabled={busy || pairingCode.length !== 4}
            onClick={() => void act({ type: 'JOIN_PAIRING', pairingCode })}
          >
            Pair device
          </button>
        </section>
      )}

      {state.pairing.paired && (
        <section className="pairedCard">
          <details open={pairingExpanded} onToggle={(event) => setPairingExpanded(event.currentTarget.open)}>
            <summary>
              Pair another device
              {state.pairing.pairingCode && <code className="pairingSummaryCode">{state.pairing.pairingCode}</code>}
            </summary>
            {state.pairing.pairingCode ? (
              <>
                <input className="pairingCode" readOnly value={state.pairing.pairingCode} aria-label="Current pairing code" />
                <p>Four-character one-time code · expires in 10 minutes</p>
              </>
            ) : (
              <p>Generate a one-time pairing code for your other device.</p>
            )}
            <div className="buttonRow">
              {state.pairing.pairingCode ? (
                <button className="ghost compact" onClick={() => void copyPairingCode()}>{copied ? 'Copied' : 'Copy pairing code'}</button>
              ) : (
                <button className="ghost compact" disabled={busy} onClick={() => void act({ type: 'CREATE_PAIRING_CODE' })}>Generate pairing code</button>
              )}
              <button className="dangerButton compact" disabled={busy} onClick={() => void act({ type: 'DISCONNECT_PAIRING' })}>Disconnect sync</button>
            </div>
            <p className="secretWarning">Only share this pairing code with your own device.</p>
          </details>
        </section>
      )}

      {state.pendingRemote && (
        <section className={`notice ${state.status === 'conflict' ? 'danger' : ''}`}>
          <strong>{state.status === 'conflict' ? 'Timetable conflict' : 'New timetable available'}</strong>
          <p>
            {formatAcademicYear(state.pendingRemote.timetable.academicYear)} · Semester {state.pendingRemote.timetable.semester} ·{' '}
            {state.pendingRemote.timetable.modules.length} modules · Remote {formatTime(state.pendingRemote.updatedAt)}
            {state.status === 'conflict' && state.current ? ` · Local ${formatTime(state.current.updatedAt)}` : ''}
          </p>
          <div className="buttonRow">
            <button className="primary compact" disabled={busy || !state.isNusmodsTab} onClick={() => void act({ type: 'APPLY_PENDING_REMOTE' })}>
              Use remote
            </button>
            <button className="ghost compact" disabled={busy} onClick={() => void act({ type: state.status === 'conflict' ? 'KEEP_LOCAL' : 'IGNORE_PENDING_REMOTE' })}>
              {state.status === 'conflict' ? 'Keep local' : 'Ignore'}
            </button>
          </div>
        </section>
      )}

      <section className="currentCard">
        {current ? (
          <>
            <div className="eyebrow">Current</div>
            <div className="term">{formatAcademicYear(current.academicYear)} <span>Semester {current.semester}</span></div>
            <div className="moduleCount">{current.modules.length} module{current.modules.length === 1 ? '' : 's'}</div>
            <div className="lastSync">
              {state.lastSyncedAt ? `Last synced ${formatTime(state.lastSyncedAt)}` : 'Not synced yet'}
            </div>
          </>
        ) : (
          <>
            <div className="eyebrow">No timetable captured</div>
            <p className="emptyCopy">Open a NUSMods timetable to get started.</p>
          </>
        )}
        <button className="primary syncButton" disabled={busy || !state.isNusmodsTab || !paired} onClick={() => void act({ type: 'SYNC_NOW' })}>
          {busy ? 'Working…' : 'Sync now'}
        </button>
        {!state.isNusmodsTab && <div className="hint">Open nusmods.com/timetable to sync or restore.</div>}
      </section>

      <section className="section profilesSection">
        <div className="sectionTitle">
          <h2>Timetables</h2>
          <button
            className="smallButton"
            disabled={busy || !current}
            onClick={() => void act({ type: 'SAVE_PROFILE' })}
          >
            Save current
          </button>
        </div>
        {state.profiles.length === 0 ? (
          <p className="emptyCopy">Save the current timetable to add its tab to NUSMods.</p>
        ) : (
          <ul className="profileList">
            {state.profiles.map((profile) => (
              <li className={!state.activeFriendId && profile.id === state.activeProfileId ? 'activeProfile' : ''} key={profile.id}>
                <button
                  className="profileName"
                  disabled={busy || !state.isNusmodsTab}
                  onClick={() => void act({ type: 'ACTIVATE_PROFILE', profileId: profile.id })}
                >
                  <strong>{profile.name}</strong>
                  <span>Semester {profile.timetable.semester} · {profile.timetable.modules.length} modules</span>
                </button>
                <div className="profileActions">
                  <button
                    title="Rename"
                    onClick={() => {
                      const name = window.prompt('Timetable name', profile.name);
                      if (name !== null) void act({ type: 'RENAME_PROFILE', profileId: profile.id, name });
                    }}
                  >Rename</button>
                  <button title="Duplicate timetable" onClick={() => void act({ type: 'DUPLICATE_PROFILE', profileId: profile.id })}>Duplicate</button>
                  <button
                    className="copyLinkAction"
                    title={profileLinkCopied === profile.id ? 'NUSMods share link copied' : 'Copy NUSMods share link'}
                    aria-label={profileLinkCopied === profile.id ? `${profile.name} share link copied` : `Copy ${profile.name} NUSMods share link`}
                    onClick={() => void copyProfileShareLink(profile.id)}
                  >
                    {profileLinkCopied === profile.id ? '✓' : (
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="5" y="5" width="8" height="8" rx="1" />
                        <path d="M3 10V3h7" />
                      </svg>
                    )}
                  </button>
                  <button
                    className="deleteAction"
                    title="Delete"
                    onClick={() => {
                      if (window.confirm(`Delete “${profile.name}”?`)) void act({ type: 'DELETE_PROFILE', profileId: profile.id });
                    }}
                  >Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section friendsSection">
        <div className="sectionTitle">
          <h2>Friends</h2>
          <button className="smallButton" disabled={busy || !current || Boolean(state.activeFriendId)} onClick={() => void shareCurrent()}>
            {shareCopied === 'current' ? 'Copied ✓' : 'Share timetable'}
          </button>
        </div>
        <p className="sectionCopy">One click copies a read-only link. Add a link below to compare timetables.</p>
        <div className="friendAdd">
          <input
            value={friendLink}
            placeholder="Paste a friend link here"
            aria-label="Friend timetable link"
            onChange={(event) => setFriendLink(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void addFriend(); }}
          />
          <button className="ghost compact" disabled={busy || !friendLink.trim()} onClick={() => void addFriend()}>Add</button>
        </div>
        <label className="commonFreeRow">
          <input
            type="checkbox"
            checked={state.settings.showCommonFreeTime}
            onChange={(event) => void act({ type: 'SET_SETTINGS', settings: { showCommonFreeTime: event.target.checked } })}
          />
          Highlight common free time
        </label>

        {state.friends.length > 0 && (
          <ul className="friendList">
            {state.friends.map((friend) => (
              <li className={`${friend.enabled ? 'visibleFriend' : ''} ${friend.id === state.activeFriendId ? 'activeFriend' : ''}`} key={friend.id}>
                <span className="friendAvatar" aria-hidden="true">{friend.name.trim().charAt(0).toUpperCase() || '?'}</span>
                <button className="friendName" disabled={busy || !friend.timetable} onClick={() => void act({ type: 'SET_FRIEND_ENABLED', friendId: friend.id, enabled: !friend.enabled })}>
                  <strong>{friend.name}</strong>
                  <span>{friend.timetable ? `${friend.timetable.modules.length} modules · ${friend.enabled ? 'visible on timetable' : 'hidden'}` : 'Waiting for timetable'}</span>
                </button>
                <label className="friendSwitch" title={`${friend.enabled ? 'Hide' : 'Show'} ${friend.name} on the timetable`}>
                  <input
                    type="checkbox"
                    checked={friend.enabled}
                    disabled={busy || !friend.timetable}
                    aria-label={`${friend.enabled ? 'Hide' : 'Show'} ${friend.name} on the timetable`}
                    onChange={(event) => void act({ type: 'SET_FRIEND_ENABLED', friendId: friend.id, enabled: event.target.checked })}
                  />
                  <span />
                </label>
                <div className="friendActions">
                  <button onClick={() => {
                    const name = window.prompt('Friend name', friend.name);
                    if (name !== null) void act({ type: 'RENAME_FRIEND', friendId: friend.id, name });
                  }}>Rename</button>
                  <button className="deleteAction" onClick={() => void act({ type: 'REMOVE_FRIEND', friendId: friend.id })}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {state.ownedFriendShares.length > 0 && (
          <details className="sharedLinks">
            <summary>Your shared links</summary>
            <ul>
              {state.ownedFriendShares.map((share) => (
                <li key={share.id}>
                  <span>{share.name}</span>
                  <div>
                    <button onClick={() => void copyShare(share.id, encodeFriendLink(share.access))}>{shareCopied === share.id ? 'Copied' : 'Copy'}</button>
                    <button className="deleteAction" onClick={() => void act({ type: 'REVOKE_FRIEND_SHARE', shareId: share.id })}>Stop</button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {(actionError || state.error) && <div className="errorBox">{actionError ?? state.error}</div>}

      <section className="section">
        <div className="sectionTitle">
          <h2>Recent versions</h2>
          {state.history.length > 4 && (
            <button className="textButton" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show less' : 'View history'}</button>
          )}
        </div>
        {visibleHistory.length === 0 ? (
          <p className="emptyCopy">Meaningful changes will appear here.</p>
        ) : (
          <ol className="historyList">
            {visibleHistory.map((snapshot, index) => (
              <li key={snapshot.id}>
                <div className="historyMain">
                  <span className="historyTime">{formatTime(snapshot.savedAt)}</span>
                  <span className="historySummary">{index === 0 ? 'Current · ' : ''}{snapshot.summary}</span>
                </div>
                {index > 0 && (
                <button className="restore" disabled={busy || !state.isNusmodsTab || Boolean(state.activeFriendId)} onClick={() => void act({ type: 'RESTORE_HISTORY', snapshotId: snapshot.id })}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="section settings">
        <div>
          <h2>Settings</h2>
          <p>Save timetable changes automatically</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={state.settings.autoSync}
            onChange={(event) => void act({ type: 'SET_SETTINGS', settings: { autoSync: event.target.checked } })}
          />
          <span />
        </label>
      </section>
    </main>
  );
}
