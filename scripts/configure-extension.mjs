import { writeFile } from 'node:fs/promises';

const relayUrl = process.argv[2]?.trim().replace(/\/$/u, '');
if (!relayUrl || !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/iu.test(relayUrl)) {
  console.error('Usage: npm run extension:configure-relay -- https://your-worker.workers.dev');
  process.exit(1);
}
await writeFile(new URL('../.env.relay.local', import.meta.url), `VITE_RELAY_URL=${relayUrl}\n`);
console.log('[NUSMods Sync] Relay URL configured. Run npm run build.');
