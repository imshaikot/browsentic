import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { COVERAGE_AREAS, CoverageByArea } from './vitest.coverage';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The daemon ships as one tsup bundle that pins zod to its own copy and resolves `@` to src.
// Its tests resolve the same way, so they exercise the zod that actually runs.
const daemonResolve = {
  alias: [
    { find: /^@\//, replacement: `${at('./src')}/` },
    { find: /^zod(\/.*)?$/, replacement: `${at('./src/daemon/node_modules/zod')}$1` },
  ],
};

export default defineConfig({
  test: {
    reporters: ['default', new CoverageByArea()],
    projects: [
      {
        plugins: [WxtVitest()],
        test: {
          name: 'lib',
          include: ['src/lib/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/lib/actions/page/**'],
        },
      },
      {
        plugins: [WxtVitest()],
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/lib/actions/page/**/*.test.ts'],
        },
      },
      {
        resolve: daemonResolve,
        test: {
          name: 'daemon',
          include: ['src/daemon/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/daemon/test/**'],
          setupFiles: ['src/daemon/test/sandbox.ts'],
        },
      },
      {
        resolve: daemonResolve,
        test: {
          name: 'integration',
          include: ['src/daemon/test/**/*.test.ts'],
          setupFiles: ['src/daemon/test/sandbox.ts'],
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test-d.ts', 'src/**/*.d.ts', 'src/daemon/test/**', 'src/daemon/dist/**'],
      reporter: ['json-summary', 'html'],
      thresholds: Object.fromEntries(COVERAGE_AREAS.map(({ glob, lines }) => [glob, { lines }])),
    },
  },
});
