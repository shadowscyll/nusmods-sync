import { sendRuntimeMessage } from '../shared/messages';
import type { PopupState, RuntimeMessage } from '../shared/types';
import { renderFriendOverlay } from '../nusmods/friendOverlay';

const HOST_ID = 'nusmods-sync-root';

const styles = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .tabsBar { position: fixed; top: 10px; left: 50%; z-index: 2147483646; display: flex; max-width: calc(100vw - 32px); transform: translateX(-50%); border: 1px solid #d9dde3; border-radius: 7px; background: #fff; box-shadow: 0 2px 8px rgba(25, 32, 43, .12); font: 500 12px/1.2 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #30343b; }
  .tabs { display: flex; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab, .addTab { flex: 0 0 auto; min-height: 34px; border: 0; border-right: 1px solid #e7e9ed; padding: 0 13px; background: #fff; color: #4b515b; font: inherit; cursor: pointer; white-space: nowrap; }
  .tab:first-child { border-radius: 6px 0 0 6px; }
  .tab:hover, .addTab:hover { background: #f5f6f7; }
  .tab.active { color: #d24b2a; box-shadow: inset 0 -2px #ee6b45; font-weight: 650; }
  .tab.dragging { opacity: .45; }
  .friendDivider { width: 1px; margin: 7px 3px; background: #d9dde3; }
  .friendTab { color: #326b91; }
  .friendTab.active { border-radius: 0; background: #eef6fa; color: #23628c; box-shadow: inset 0 -2px #3e8dbc; font-weight: 650; }
  .backTab { font-weight: 650; }
  .friendDot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--friend-color); vertical-align: 1px; }
  .addTab { border-right: 0; border-radius: 0 6px 6px 0; padding: 0 12px; color: #252a31; font-size: 17px; }
  .tabMenu { position: absolute; top: 38px; z-index: 2; display: grid; min-width: 108px; padding: 4px; border: 1px solid #d9dde3; border-radius: 6px; background: #fff; box-shadow: 0 4px 14px rgba(25, 32, 43, .18); }
  .tabMenu button { border: 0; border-radius: 4px; padding: 7px 9px; background: transparent; color: #353a42; font: 500 12px/1.2 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: left; cursor: pointer; }
  .tabMenu button:hover { background: #f2f3f5; }
  .tabMenu .delete { color: #aa4242; }
  .statusWrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #292d33; }
  .statusPill, .notice { border: 1px solid #d9dde3; border-radius: 7px; background: #fff; box-shadow: 0 2px 8px rgba(25, 32, 43, .12); }
  .statusPill { display: flex; align-items: center; gap: 7px; padding: 8px 10px; font-size: 12px; font-weight: 600; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #3a8d5d; }
  .saving .dot { background: #d78b24; animation: pulse 1s infinite; }
  .error .dot, .conflict .dot { background: #c64747; }
  .update-available .dot { background: #d78b24; }
  .notice { width: min(340px, calc(100vw - 32px)); padding: 14px; }
  .title { margin: 0 0 5px; font-size: 14px; font-weight: 700; }
  .body { margin: 0; color: #656b74; font-size: 12px; line-height: 1.45; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .actions button { border: 1px solid #d7dae0; border-radius: 5px; padding: 7px 10px; background: #fff; color: #343940; font: 600 12px/1.2 inherit; cursor: pointer; }
  .actions .primary { border-color: #de5d3a; background: #e96843; color: #fff; }
  .friendNotice { border-color: #9fc5dc; }
  @keyframes pulse { 50% { opacity: .35; } }
  @media (max-width: 680px) { .tabsBar { top: 6px; max-width: calc(100vw - 16px); } .tab { padding: 0 10px; } }
  @media (prefers-color-scheme: dark) { .tabsBar, .tab, .addTab, .statusPill, .notice, .actions button, .tabMenu { border-color: #454a52; background: #262a30; color: #e8e9eb; } .tab:hover, .addTab:hover, .tabMenu button:hover { background: #30353c; } .tabMenu button { color: #e8e9eb; } .tabMenu .delete { color: #f09a9a; } .body { color: #b4b8bf; } .friendDivider { background: #454a52; } .friendTab { color: #8bc5e8; } .friendTab.active { background: #263a45; } }
`;

const labels: Record<PopupState['status'], string> = {
  idle: 'Sync ready',
  saving: 'Saving',
  synced: 'Synced',
  'update-available': 'Update available',
  conflict: 'Timetable conflict',
  error: 'Sync failed',
};

const pushLabels: Record<PopupState['pushStatus'], string> = {
  live: 'Live',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

function messageButton(label: string, className: string, message: RuntimeMessage): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className;
  button.addEventListener('click', () => void sendRuntimeMessage(message));
  return button;
}

function renderTabs(root: ShadowRoot, state: PopupState): void {
  if (!window.location.pathname.startsWith('/timetable')) return;
  const bar = document.createElement('nav');
  bar.className = 'tabsBar';
  bar.setAttribute('aria-label', 'Saved timetables');
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  let draggedId: string | undefined;
  if (state.activeFriendId) {
    const back = messageButton('← Mine', 'tab backTab', { type: 'VIEW_FRIEND' });
    back.title = 'Return to your timetable';
    tabs.append(back);
  }
  const rename = (profileId: string, currentName: string): void => {
    const name = window.prompt('Timetable name', currentName);
    if (name !== null) void sendRuntimeMessage({ type: 'RENAME_PROFILE', profileId, name });
  };
  const openMenu = (button: HTMLButtonElement, profileId: string, currentName: string): void => {
    root.querySelector('.tabMenu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'tabMenu';
    menu.style.left = `${button.offsetLeft}px`;
    const renameButton = document.createElement('button');
    renameButton.textContent = 'Rename';
    renameButton.addEventListener('click', () => rename(profileId, currentName));
    const duplicateButton = messageButton('Duplicate', '', { type: 'DUPLICATE_PROFILE', profileId });
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.className = 'delete';
    deleteButton.addEventListener('click', () => {
      if (window.confirm(`Delete “${currentName}”?`)) {
        void sendRuntimeMessage({ type: 'DELETE_PROFILE', profileId });
      }
    });
    menu.append(renameButton, duplicateButton, deleteButton);
    bar.append(menu);
    window.setTimeout(() => window.addEventListener('click', () => menu.remove(), { once: true }), 0);
  };
  for (const profile of state.profiles) {
    const active = !state.activeFriendId && profile.id === state.activeProfileId;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = profile.name;
    button.className = `tab${active ? ' active' : ''}`;
    let activationTimer: number | undefined;
    button.addEventListener('click', () => {
      if (activationTimer !== undefined) window.clearTimeout(activationTimer);
      activationTimer = window.setTimeout(() => {
        activationTimer = undefined;
        void sendRuntimeMessage({ type: 'ACTIVATE_PROFILE', profileId: profile.id });
      }, 220);
    });
    button.title = `${profile.name} · ${profile.timetable.modules.length} modules`;
    button.setAttribute('aria-current', active ? 'page' : 'false');
    button.draggable = true;
    button.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (activationTimer !== undefined) window.clearTimeout(activationTimer);
      activationTimer = undefined;
      rename(profile.id, profile.name);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openMenu(button, profile.id, profile.name);
    });
    button.addEventListener('dragstart', (event) => {
      draggedId = profile.id;
      event.dataTransfer?.setData('text/plain', profile.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      button.classList.add('dragging');
    });
    button.addEventListener('dragend', () => {
      draggedId = undefined;
      button.classList.remove('dragging');
    });
    button.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!draggedId || draggedId === profile.id) return;
      const ids = state.profiles.map((item) => item.id);
      const from = ids.indexOf(draggedId);
      const to = ids.indexOf(profile.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      void sendRuntimeMessage({ type: 'REORDER_PROFILES', profileIds: ids });
    });
    tabs.append(button);
  }
  if (state.friends.length > 0) {
    const divider = document.createElement('span');
    divider.className = 'friendDivider';
    tabs.append(divider);
    for (const friend of state.friends) {
      const button = messageButton(friend.name, `tab friendTab${friend.enabled ? ' active' : ''}`, {
        type: 'SET_FRIEND_ENABLED', friendId: friend.id, enabled: !friend.enabled,
      });
      button.style.setProperty('--friend-color', ['#2676a5', '#7a55a3', '#b46826', '#2f8261', '#a44566', '#5d6f94'][state.friends.indexOf(friend) % 6]);
      const dot = document.createElement('span');
      dot.className = 'friendDot';
      button.prepend(dot);
      button.disabled = !friend.timetable;
      button.title = friend.timetable ? `${friend.enabled ? 'Hide' : 'Show'} ${friend.name}'s overlay` : 'Waiting for timetable';
      tabs.append(button);
    }
  }
  const add = messageButton('+', 'addTab', { type: 'ADD_PROFILE_TAB' });
  add.disabled = Boolean(state.activeFriendId);
  add.title = 'Create a new timetable';
  add.setAttribute('aria-label', 'Create a new timetable');
  bar.append(tabs, add);
  root.append(bar);
}

function renderStatus(root: ShadowRoot, state: PopupState): void {
  const wrap = document.createElement('aside');
  wrap.className = `statusWrap ${state.status}`;
  if (state.activeFriendId) {
    const friend = state.friends.find((item) => item.id === state.activeFriendId);
    const notice = document.createElement('div');
    notice.className = 'notice friendNotice';
    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = friend ? `Viewing ${friend.name}` : 'Viewing friend timetable';
    const body = document.createElement('p');
    body.className = 'body';
    body.textContent = 'Read only · your timetable and sync stay unchanged.';
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(messageButton('Back to mine', 'primary', { type: 'VIEW_FRIEND' }));
    notice.append(title, body, actions);
    wrap.append(notice);
  } else if (state.status === 'update-available' || state.status === 'conflict') {
    const notice = document.createElement('div');
    notice.className = 'notice';
    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = state.status === 'conflict' ? 'Timetable conflict' : 'New timetable available';
    const body = document.createElement('p');
    body.className = 'body';
    const remote = state.pendingRemote;
    body.textContent = remote
      ? `AY${remote.timetable.academicYear}, Semester ${remote.timetable.semester}, ${remote.timetable.modules.length} modules. Review it before importing.`
      : 'A newer timetable is available from another device.';
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(messageButton('Use remote', 'primary', { type: 'APPLY_PENDING_REMOTE' }));
    actions.append(
      messageButton(state.status === 'conflict' ? 'Keep local' : 'Ignore', '', {
        type: state.status === 'conflict' ? 'KEEP_LOCAL' : 'IGNORE_PENDING_REMOTE',
      }),
    );
    notice.append(title, body, actions);
    wrap.append(notice);
  } else {
    const pill = document.createElement('div');
    pill.className = 'statusPill';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = state.pairing.paired
      ? `${labels[state.status]} · ${pushLabels[state.pushStatus]}`
      : 'Pair devices';
    pill.append(dot, label);
    wrap.append(pill);
  }
  root.append(wrap);
}

export function renderIndicator(state: PopupState): void {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.documentElement.append(host);
    host.attachShadow({ mode: 'open' });
  }
  const root = host.shadowRoot;
  if (!root) return;
  root.replaceChildren();
  const style = document.createElement('style');
  style.textContent = styles;
  root.append(style);
  renderTabs(root, state);
  renderStatus(root, state);
  void renderFriendOverlay(state);
}
