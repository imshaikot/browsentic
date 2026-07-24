import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Not `.output` — dot-directories are hidden in Finder and Chrome's
  // "Load unpacked" picker.
  outDir: 'dist',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'VoiceLink',
    description: 'Talk to an AI assistant about any page — voice-first AI in your browser.',
    // `alarms` revives the service worker so it can redial the MCP daemon. `scripting` +
    // host_permissions let the extension re-inject its content script into tabs that were
    // already open when it was installed or reloaded — declared content scripts only load
    // with the page, so without this every pre-existing tab is TAB_UNREACHABLE until
    // refreshed. `activeTab` alone can't do this: it covers only the active tab after a user
    // gesture, not the install-time sweep of every tab or daemon-driven injection.
    //
    // host_permissions matches the content script's own `*://*/*`, so Chrome shows no extra
    // install warning — but note it grants the *extension process* real origin access it did
    // not have before (cross-origin fetch from the worker, reading tab.url/title without the
    // `tabs` permission). We only use it to inject; nothing here reads page data out-of-band.
    // `unlimitedStorage` lifts the ~10 MB `storage.local` quota so the file repository
    // (metadata index + base64 file bytes) can hold real documents.
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'sidePanel', 'alarms', 'scripting'],
    host_permissions: ['*://*/*'],
  },
});
