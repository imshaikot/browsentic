import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { describe, expect, test } from 'vitest';

const src = fileURLToPath(new URL('../..', import.meta.url));

/** The phone's page bundle as the extension ships it, minus WXT's wrapper: everything the phone page's isolated world will run. */
async function bundled(): Promise<string> {
  const output = (await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [{ find: /^@\//, replacement: `${src}/` }] },
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./page-api.ts', import.meta.url)), formats: ['iife'], name: 'phonePage' } },
  })) as Rollup.RollupOutput[];
  return output[0].output.map((chunk) => ('code' in chunk ? chunk.code : '')).join('\n');
}

describe('the page bundle a phone page runs', () => {
  test('reaches for no extension API, since there is none in a phone page', async () => {
    const code = await bundled();
    expect(code).toContain('__browsenticPhone');
    expect(code.match(/\b(?:chrome|browser)\.(?:runtime|tabs|storage|scripting|debugger)\b/g)).toBeNull();
  }, 60_000);
});
