import { access, readFile } from 'node:fs/promises';

async function manifest(browser) {
  return JSON.parse(await readFile(new URL(`../dist/${browser}/manifest.json`, import.meta.url), 'utf8'));
}

const [chromeManifest, firefoxManifest] = await Promise.all([manifest('chrome'), manifest('firefox')]);
const [chromePopup, firefoxPopup] = await Promise.all([
  readFile(new URL('../dist/chrome/src/popup/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../dist/firefox/src/popup/index.html', import.meta.url), 'utf8'),
]);

function assert(condition, message) {
  if (!condition) throw new Error(`[NUSMods Sync] Build verification failed: ${message}`);
}

for (const [browser, value] of [['Chrome', chromeManifest], ['Firefox', firefoxManifest]]) {
  assert(value.version === '1.1', `${browser} version is wrong`);
  assert(
    value.permissions.length === 3 &&
      value.permissions.includes('storage') &&
      value.permissions.includes('alarms') &&
      value.permissions.includes('scripting'),
    `${browser} permissions changed`,
  );
  assert(!value.host_permissions.includes('<all_urls>'), `${browser} requests <all_urls>`);
  assert(value.host_permissions.some((entry) => entry.endsWith('.workers.dev/*')), `${browser} relay origin is missing`);
  assert(!value.host_permissions.some((entry) => entry.includes('relay-not-configured.invalid')), `${browser} was built without a relay URL`);
  assert(value.content_scripts[0].matches.includes('https://nusmods.com/*'), `${browser} does not cover NUSMods SPA navigation`);
}

assert(chromeManifest.background.service_worker === 'service-worker-loader.js', 'Chrome background worker is missing');
assert(!chromePopup.includes('modulepreload'), 'Chrome popup contains cross-world module preloads');
assert(!firefoxPopup.includes('modulepreload'), 'Firefox popup contains unnecessary module preloads');
const chromeLoaderUrl = new URL('../dist/chrome/service-worker-loader.js', import.meta.url);
await access(chromeLoaderUrl);
const chromeLoader = await readFile(chromeLoaderUrl, 'utf8');
const chromeBackgroundMatch = chromeLoader.match(/['"]\.\/(assets\/[^'"]+\.js)['"]/u);
assert(chromeBackgroundMatch, 'Chrome background loader does not import a worker bundle');
await access(new URL(`../dist/chrome/${chromeBackgroundMatch[1]}`, import.meta.url));

const firefoxBackground = firefoxManifest.background.scripts?.[0];
assert(typeof firefoxBackground === 'string' && firefoxBackground.includes('background'), 'Firefox points at the wrong background bundle');
assert(!firefoxManifest.web_accessible_resources?.some((entry) => 'use_dynamic_url' in entry), 'Firefox contains Chromium-only use_dynamic_url');
await access(new URL(`../dist/firefox/${firefoxBackground}`, import.meta.url));

console.log('[NUSMods Sync] Chrome and Firefox manifests verified.');
