import { defineConfig } from 'tsup';

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
