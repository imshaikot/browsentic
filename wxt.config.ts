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
  manifest: {
    name: 'Browsentic',
    description: 'Reimagine browsing as agentic — driven by the AI agent you already run, in your own logged-in browser.',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'sidePanel', 'contextMenus', 'alarms', 'scripting', 'notifications', 'debugger'],
    host_permissions: ['<all_urls>'],
  },
});
