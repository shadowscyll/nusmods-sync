# Encrypted relay deployment

## What Cloudflare can see

The Worker stores timetable ciphertext plus one-time encrypted pairing handoffs. Timetable keys remain inside paired extension installations. Pairing handoffs expire after 10 minutes and are deleted when redeemed. Durable Object notification rooms see only vault identifiers, device identifiers, and update timestamps—not timetable contents or encryption keys.

## Deploy

From the project root:

```bash
npm ci
npx wrangler login
npm run relay:create-db
```

Copy the D1 database ID from Wrangler's output:

```bash
npm run relay:configure-db -- YOUR_DATABASE_ID
npm run relay:migrate
npm run relay:deploy
```

Check the returned endpoint:

```bash
curl https://YOUR-WORKER.workers.dev/health
```

Expected response:

```json
{"ok":true,"version":"1.0.1"}
```

Configure and build the extension:

```bash
npm run extension:configure-relay -- https://YOUR-WORKER.workers.dev
npm run verify
```

The exact origin is added to `host_permissions`; the extension does not request arbitrary network access.

## Update the Worker

When upgrading from 0.5.x to 0.6.0, keep the configured D1 database ID and deploy:

```bash
npm run relay:deploy
```

Wrangler applies the included `v1` migration and creates the SQLite-backed `SyncRoom` Durable Object namespace. There is no additional D1 migration for this upgrade.

When upgrading from 0.6.x to 0.7.0, deploy the Worker again so it accepts the larger encrypted workspace payload. No D1 migration is required.

When upgrading to 0.8.0, create the read-only friend-share table before deployment:

```bash
npm run relay:migrate
npm run relay:deploy
```

Version 1.0.1 does not add another D1 migration. Deploy its Worker to enable atomic multi-device writes and collision-safe pairing codes.

After changing `relay/` in a later release, use the same deployment command.

Schema migrations must be additive and should be applied with a new SQL migration before deployment. The initial `relay/schema.sql` is idempotent.

## Retention and deletion

Every successful timetable upload extends its vault expiry by 90 days. Expired rows return `404` and can be deleted periodically from the D1 console:

```sql
DELETE FROM vaults WHERE expires_at <= unixepoch('now') * 1000;
```

Disconnecting an extension removes its local pairing secret but does not immediately delete the remote ciphertext, allowing another paired device to continue syncing. The ciphertext expires after inactivity.

## Troubleshooting

- `Relay URL is not configured`: run `extension:configure-relay`, then rebuild and reload the extension.
- `Sync connection was not found or has expired`: set up sync again on one device and pair the others.
- `Unauthorized`: the pairing code is wrong or the vault ID was replaced. Re-copy the complete code.
- `A newer or identical version already exists`: the extension downloads that version and offers conflict handling when appropriate.
- Instant updates not arriving: confirm both devices use extension 0.6.0 or later, deploy the updated Worker, and keep a NUSMods timetable page open on the receiving device. The five-minute fallback check will still recover missed notifications.
- Existing NUSMods tabs need one refresh after installing or reloading an unpacked extension. Normal homepage-to-timetable navigation is detected afterward.
