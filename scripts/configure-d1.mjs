import { readFile, writeFile } from 'node:fs/promises';

const databaseId = process.argv[2]?.trim();
if (!databaseId || !/^[0-9a-f-]{32,36}$/iu.test(databaseId)) {
  console.error('Usage: npm run relay:configure-db -- <D1_DATABASE_ID>');
  process.exit(1);
}
const path = new URL('../relay/wrangler.jsonc', import.meta.url);
const current = await readFile(path, 'utf8');
const next = current.replace(/"database_id":\s*"[^"]+"/u, `"database_id": "${databaseId}"`);
await writeFile(path, next);
console.log('[NUSMods Sync] D1 database configured.');
