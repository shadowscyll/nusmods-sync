import { readFile, writeFile } from 'node:fs/promises';

const manifestPath = new URL('../dist/firefox/manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
for (const entry of manifest.web_accessible_resources ?? []) delete entry.use_dynamic_url;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
