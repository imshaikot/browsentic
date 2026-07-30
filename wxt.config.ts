import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: 'dist',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'VoiceLink',
    description: 'Talk to an AI assistant about any page — voice-first AI in your browser.',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'sidePanel', 'alarms', 'scripting'],
    host_permissions: ['*://*/*'],
  },
});
