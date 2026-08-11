import { rm } from 'node:fs/promises';

const target = process.argv[2];
if (target !== 'chrome' && target !== 'firefox') {
  throw new Error('Build target must be chrome or firefox');
}

await rm(new URL(`../dist/${target}/`, import.meta.url), { recursive: true, force: true });
