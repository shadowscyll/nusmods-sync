# NUSMods Sync

NUSMods Sync keeps NUSMods timetables synchronized across Chrome and Firefox without requiring an account. Version 1.1 keeps the original compact sync status while retaining native share links, revision ordering, and adaptive batching.

## How it works

1. The extension reads NUSMods' validated `persist:timetables` state and normalizes the active timetable.
2. It encrypts the complete normalized workspace locally with AES-256-GCM, including saved timetable tabs, names, order, and active selection.
3. The Cloudflare relay stores timetable ciphertext and never receives the encryption key.
4. A second browser joins using a four-character pairing code such as `7KMP`. The temporary encrypted handoff expires after 10 minutes and is deleted when used.
5. Each open NUSMods timetable uses a short-lived ticket to connect to its encrypted vault's Durable Object notification room. The long-lived write capability is never placed in the WebSocket URL.
6. Every accepted workspace upload receives a monotonically increasing revision. Other devices immediately fetch the encrypted D1 envelope, decrypt it locally, and apply it when there is no conflict.
7. After NUSMods confirms that revision was applied, the receiving device sends an internal acknowledgement for recovery and diagnostics.
8. The socket reconnects automatically. Five-minute foreground and 15-minute background checks recover updates missed while disconnected or closed.
9. Restore uses NUSMods' native share/import flow and confirms its Import action automatically. If NUSMods changes that page, the preview stays open for manual import.

## Timetable tabs

Select **Save current** in the popup to save the visible timetable. The **+** button in the NUSMods tab strip creates a new empty timetable. On its first use, the visible timetable is preserved as `1` and the new empty timetable opens as `2`; later presses create `3`, `4`, and so on.

- Select a tab to switch to it in one click without a full page reload. The extension confirms NUSMods' native **Import** action automatically.
- The timetable being replaced is saved to local history first.
- Changes made while a profile is active update that saved profile automatically.
- Switching tabs saves the visible timetable directly before activating the next tab, so rapid edits are preserved even before the normal capture debounce finishes.
- Rename, duplicate, or delete profiles from the popup.
- Copy a saved timetable's native NUSMods share URL from the copy-link icon beside its actions.
- Drag tabs on NUSMods to reorder them, double-click to rename, or right-click for Rename, Duplicate, and Delete.
- Up to 10 profiles synchronize end-to-end encrypted across paired devices.

The popup and NUSMods status pill show **Connecting**, **Live**, **Reconnecting**, or **Offline** for the instant-push connection.

## Friend timetables

Select **Share current** in the popup to copy an encrypted, read-only link for the visible timetable. The recipient can open the link, select **Paste**, or paste it manually into **Friends**. Existing shares reuse the same link instead of creating duplicates.

- Friend chips toggle translucent lesson overlays directly on your own NUSMods timetable without importing or replacing it.
- Overlay blocks resolve class numbers against the official NUSMods module timetable API and show the friend, module, lesson, time, and venue.
- **Free time** highlights gaps of at least 30 minutes when your timetable and every visible friend are all free.
- Updates are encrypted locally and delivered through a separate live notification connection.
- Friend links have a separate read capability and encryption key. They never expose the pairing code, workspace write capability, tab names, or other saved timetables.
- Rename or remove a friend locally. The owner can copy the link again or select **Stop** to revoke it for everyone.
- Modules already present on your timetable reuse their rendered NUSMods color; the friend border remains distinct.

The relay rejects stale workspace writes with an atomic monotonic revision check. Friend-share updates continue to use `updatedAt` plus a deterministic device-ID tie-break. Push messages contain no timetable data; local history remains in extension-local storage and is never uploaded.

## Privacy and security

The extension does not collect credentials, account information, browsing history, analytics, or telemetry. It runs only on NUSMods pages and contacts the official NUSMods timetable API plus the exact relay origin embedded during the build.

Pairing codes are one-time secrets. Only enter a code on your own device. The relay stores the handoff encrypted, deletes it after use, and expires unused codes after 10 minutes.

Permissions:

- `storage`: device identity, pairing secret, current state, and local history
- `alarms`: efficient background checks
- `scripting`: attach the NUSMods integration to tabs that were already open when the extension was installed or updated
- NUSMods host access
- read-only access to the official `api.nusmods.com` module timetable JSON
- the single configured `workers.dev` relay origin

There is no `<all_urls>` permission.

## One-time relay deployment

Requirements: Node.js 22+, npm, and a free Cloudflare account.

```bash
npm ci
npx wrangler login
npm run relay:create-db
```

The last command prints a D1 `database_id`. Copy it, then run:

```bash
npm run relay:configure-db -- YOUR_DATABASE_ID
npm run relay:migrate
npm run relay:deploy
```

Deployment prints a URL similar to:

```text
https://nusmods-sync-relay.your-subdomain.workers.dev
```

Embed that exact origin into both browser builds:

```bash
npm run extension:configure-relay -- https://nusmods-sync-relay.your-subdomain.workers.dev
npm run verify
```

Never commit `.env.relay.local`, pairing codes, Cloudflare tokens, or Wrangler credentials.

When upgrading an existing deployment to version 1.1, run `npm run relay:deploy` before installing the new browser builds. No D1 migration or device re-pairing is required.

See [`docs/relay-deployment.md`](docs/relay-deployment.md) for troubleshooting and maintenance.

## Install the extension

### Chrome or Microsoft Edge

1. Download `nusmods-sync-chrome-unpacked-1.1.zip` and extract it to a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Microsoft Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted folder containing `manifest.json`.
6. Refresh any NUSMods tabs that were already open.

Do not delete the extracted folder while the extension is installed.

### Firefox

1. Download the signed `nusmods-sync-1.1.xpi` file.
2. Open `about:addons` in Firefox.
3. Select the gear menu, then **Install Add-on From File…**.
4. Choose `nusmods-sync-1.1.xpi` and confirm the installation.
5. Refresh any NUSMods tabs that were already open.

The XPI must retain Mozilla's signature. Editing or repackaging it will make Firefox reject it.

### Firefox temporary development build

1. Build the extension with `npm run build:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on**.
4. Choose `dist/firefox/manifest.json`.

## Pair devices

On the first device:

1. Open the extension popup.
2. Select **Start on this device**.
3. Open **Pair another device** and copy the pairing code.

On another Chrome or Firefox device using a build configured for the same relay:

1. Open the popup.
2. Enter the four-character pairing code.
3. Select **Pair device**.
4. Open NUSMods. When an update appears, select **Use remote**. NUSMods' native import action is completed automatically.

Chrome and Firefox can now sync with each other because they use the same encrypted relay rather than browser-account storage.

## Mozilla reviewer build instructions

These instructions reproduce the submitted Firefox add-on from source.

### Build environment

- Operating system: Linux x86_64 (tested on Linux; no system-specific build tools are required)
- Node.js: 24.14.0
- npm: 11.9.0

Install Node.js 24.14.0 from [nodejs.org](https://nodejs.org/) or with an
existing Node version manager. With `nvm`:

```bash
nvm install 24.14.0
nvm use 24.14.0
node --version
npm --version
```

The version commands should report Node `v24.14.0` and npm `11.9.0`. npm is
included with the Node installation; no global npm packages are required.

### Reproduce the Firefox build

Extract the source archive, open a terminal in its root directory, and run:

```bash
npm ci
npm run build:firefox
```

`npm run build:firefox` is the complete build script. It type-checks the
TypeScript source, clears the previous Firefox output, runs the Vite/CRXJS
bundle with the public relay URL from `.env.relay`, applies the Firefox manifest
post-processing step, and removes build-only files. The resulting unpacked
extension is written to `dist/firefox`.

For Mozilla self-distribution, run:

```bash
npm run build:firefox:unlisted
```

This uses the distinct add-on ID
`nusmods-sync-unlisted@accountless-sync.local` and the display name
`NUSMods Sync (Unlisted)`. The default Firefox build retains the listed
add-on's original ID.

To create the installable ZIP after building, run:

```bash
node node_modules/web-ext/bin/web-ext.js build \
  --source-dir dist/firefox \
  --artifacts-dir web-ext-artifacts \
  --overwrite-dest
```

Optional verification:

```bash
npm run check
node node_modules/web-ext/bin/web-ext.js lint \
  --source-dir dist/firefox \
  --self-hosted
```

The Mozilla linter reports two `UNSAFE_VAR_ASSIGNMENT` warnings in the bundled
React production runtime. The extension source does not call `innerHTML` or use
React's `dangerouslySetInnerHTML` API.

## Development

```bash
npm ci
npm run check
npm run build
npm run relay:dev
```

Useful commands:

- `npm test`: unit tests
- `npm run check`: strict TypeScript plus tests
- `npm run build:chrome`: Chrome MV3 build
- `npm run build:firefox`: Firefox MV3 build plus manifest cleanup
- `npx wrangler deploy --dry-run --config relay/wrangler.jsonc`: compile the Worker without deploying

Development-only logs are prefixed with `[NUSMods Sync]`. Production builds omit routine debug logs.

## Architecture

```text
relay/             Cloudflare Worker, D1, Durable Object push, capability authentication
scripts/           D1/relay configuration and Firefox manifest post-processing
src/nusmods/       NUSMods persistence reader, watcher, native import builder
src/content/       NUSMods orchestration and isolated indicator
src/background/    browser coordination, polling, conflicts, messages
src/sync/          encryption, pairing, relay client, validation, history
src/popup/         React popup and pairing controls
src/shared/        versioned types, constants, browser API adapter
tests/             parsing, migration, history, conflict, pairing, crypto tests
```

## Storage

Local extension storage:

- `nusmodsSync.deviceId`
- `nusmodsSync.relayPairing` — relay endpoint, vault ID, encryption key, write capability
- `nusmodsSync.localCurrent`
- `nusmodsSync.history` — latest 30 deduplicated snapshots
- `nusmodsSync.pendingRemote`
- `nusmodsSync.ignoredRemote`
- `nusmodsSync.metadata`
- `nusmodsSync.settings`
- `nusmodsSync.profiles` — local cache of up to 10 encrypted-workspace timetables
- `nusmodsSync.activeProfileId`

D1 stores one encrypted workspace envelope per random vault ID and one encrypted timetable per active friend share. Tab names, order, timetables, active selection, and friend timetable data remain ciphertext. A SQLite-backed Durable Object holds hibernating WebSocket connections and short-lived, one-use connection tickets; notification messages contain only an update timestamp.

Short pairing codes use a separate one-time encrypted handoff table. Version 0.8.0 adds the `friend_shares` D1 table, so run `npm run relay:migrate` before deploying the updated Worker.

## Known limitations

- Instant delivery requires a NUSMods timetable page to be open. Closed browsers fetch the latest version when they reopen.
- Applying a remote version or saved tab is one click; the native preview remains as a manual fallback if NUSMods changes its import UI.
- Pairing is currently copy/paste code rather than camera QR scanning.
- Pairing codes expire after 10 minutes and can be regenerated from a connected device.
- A free Cloudflare account is required for the maintainer who deploys the relay, but not for extension users.
- The integration fails closed if NUSMods changes its reducer or share format and never writes NUSMods localStorage directly.

See [`docs/nusmods-investigation.md`](docs/nusmods-investigation.md) for the upstream integration details.
