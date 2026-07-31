import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: 'dist',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Browsentic',
    description: 'Reimagine browsing as agentic — driven by the AI agent you already run, in your own logged-in browser.',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'sidePanel', 'alarms', 'scripting'],
    host_permissions: ['*://*/*'],
  },
});
