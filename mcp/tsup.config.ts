import { defineConfig } from 'tsup';

// Bundles the extension's own `lib/actions` (resolved through the `@/*` tsconfig path) into the
// CLI, so the MCP tool list is the extension's registry rather than a copy that can drift.
export default defineConfig({
  entry: ['src/cli.ts', 'src/daemon-main.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  tsconfig: 'tsconfig.json',
  banner: { js: '#!/usr/bin/env node' },
});
