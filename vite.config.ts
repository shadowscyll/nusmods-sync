import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

import manifest from './src/manifest.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = process.env.TARGET_BROWSER === 'firefox' ? 'firefox' : 'chrome';
  const firefoxExtensionId =
    process.env.FIREFOX_EXTENSION_ID ?? 'nusmods-sync@accountless-sync.local';
  const firefoxExtensionName = process.env.FIREFOX_EXTENSION_NAME ?? manifest.name;
  const relayUrl = (process.env.VITE_RELAY_URL ?? env.VITE_RELAY_URL ?? 'https://relay-not-configured.invalid').replace(/\/$/, '');
  const relayOriginPattern = `${new URL(relayUrl).origin}/*`;
  const browserManifest = {
    ...manifest,
    name: target === 'firefox' ? firefoxExtensionName : manifest.name,
    host_permissions: [...manifest.host_permissions, relayOriginPattern],
    background:
      target === 'firefox'
        ? { scripts: ['src/background/background.ts'], type: 'module' as const }
        : manifest.background,
    ...(target === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: firefoxExtensionId,
              strict_min_version: '142.0',
              data_collection_permissions: {
                required: ['websiteContent' as const],
                optional: [],
              },
            },
          },
        }
      : {}),
  };
  return {
    define: { __RELAY_URL__: JSON.stringify(relayUrl) },
    plugins: [react(), crx({ manifest: browserManifest })],
    build: {
      outDir: `dist/${target}`,
      emptyOutDir: true,
      modulePreload: false,
      sourcemap: true,
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.ts'],
    },
  };
});
