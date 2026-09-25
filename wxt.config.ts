import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // srcDir is `src`, not `src/extension`, because WXT points its `@` alias at srcDir and
  // the daemon shares `src/lib` with the extension. Aiming `@` at src keeps `@/lib/...`
  // resolving from both halves. The extension's own files then live one level down, which
  // is why entrypoints and public are named explicitly.
  srcDir: 'src',
  // entrypointsDir resolves against srcDir; publicDir resolves against the project root.
  // They look inconsistent because they are, so both are written out in full here rather
  // than relying on memory. Getting publicDir wrong silently ships an extension with no
  // icons, because WXT discovers those from public/icon/*.png.
  entrypointsDir: 'extension/entrypoints',
  publicDir: 'src/extension/public',

  outDir: 'dist',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: 'Browsentic',
    description: 'Reimagine browsing as agentic — driven by the AI agent you already run, in your own logged-in browser.',
    permissions: [
      'storage', 'unlimitedStorage', 'activeTab', 'contextMenus', 'alarms', 'scripting',
      'notifications', 'downloads', 'nativeMessaging',
      // Firefox has no sidePanel or debugger permission, and addons.mozilla.org flags each name it does not know.
      ...(browser === 'firefox' ? [] : ['sidePanel', 'debugger']),
    ],
    host_permissions: ['<all_urls>'],
    // Release Firefox installs only what addons.mozilla.org has signed, and signing needs a
    // permanent id. The update URL is polled daily; the release job publishes updates.json
    // next to each signed .xpi, and `releases/latest` always resolves to the newest one.
    // websiteContent, because what the agent reads on a page reaches the model behind it.
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'browsentic@browsentic.com',
          strict_min_version: '140.0',
          update_url: 'https://github.com/imshaikot/browsentic/releases/latest/download/updates.json',
          data_collection_permissions: { required: ['websiteContent'] },
        },
      },
    }),
  }),
});
