import { readdir, readFile, rm } from 'node:fs/promises';

const target = process.argv[2];
if (target !== 'chrome' && target !== 'firefox') throw new Error('Build target must be chrome or firefox');

const root = new URL(`../dist/${target}/`, import.meta.url);
const assets = new URL('assets/', root);
const names = new Set(await readdir(assets));
const keep = new Set();

async function collect(text) {
  for (const match of text.matchAll(/(?:assets\/)?([A-Za-z0-9_.-]+\.(?:js|css))/gu)) {
    const name = match[1];
    if (!names.has(name) || keep.has(name)) continue;
    keep.add(name);
    if (names.has(`${name}.map`)) keep.add(`${name}.map`);
    if (name.endsWith('.js')) await collect(await readFile(new URL(`assets/${name}`, root), 'utf8'));
  }
}

const manifestText = await readFile(new URL('manifest.json', root), 'utf8');
const manifest = JSON.parse(manifestText);
await collect(manifestText);

const rootBackground = manifest.background?.service_worker;
if (typeof rootBackground === 'string' && !rootBackground.startsWith('assets/')) {
  await collect(await readFile(new URL(rootBackground, root), 'utf8'));
}

await collect(await readFile(new URL('src/popup/index.html', root), 'utf8'));
await Promise.all([...names].filter((name) => !keep.has(name)).map((name) => rm(new URL(name, assets))));
