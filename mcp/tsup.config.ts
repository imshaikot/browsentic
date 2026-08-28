import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/daemon-main.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,

  // No code splitting, deliberately. ws is CommonJS and calls require() for node builtins
  // at runtime; esbuild's ESM output replaces that with a shim which throws unless a real
  // `require` is in scope. The banner below supplies one, but a banner only lands on entry
  // files, and with splitting the shim ends up in a shared chunk the banner never reaches.
  // Two self-contained entries cost ~200 KB of duplication and remove the whole problem.
  splitting: false,

  // Everything is inlined, so the published package has zero runtime dependencies and
  // `npx browsentic` downloads one tarball and runs. The closure is nine packages: zod,
  // ajv, ajv-formats, ws, the MCP SDK, fast-uri, zod-to-json-schema, json-schema-traverse
  // and fast-deep-equal. Express, hono, jose and undici never enter it, because only
  // server/index.js and server/stdio.js are imported from the SDK.
  //
  // The three runtime deps therefore live in devDependencies. Moving one back into
  // dependencies would put its whole tree (~33 MB) back in front of every install, which
  // is what the node_modules assertion in the release workflow guards against.
  noExternal: [/.*/],

  // ws requires bufferutil and utf-8-validate inside try/catch. Neither is installed, so
  // esbuild emits a runtime throw that ws's own catch swallows before falling back to its
  // JS paths. That is exactly what happens today. Nothing to fix here.
  //
  // Not minified on purpose either: ~/.browsentic/daemon.log is the only debugging surface
  // this product has, and readable frames in it are worth more than the ~80 KB gzipped.
  sourcemap: true,
  tsconfig: 'tsconfig.json',

  // esbuild's require shim uses the real `require` when one is in scope and throws when it
  // is not. ESM has none, so create it. This is what lets bundled CommonJS (ws, and ajv
  // under the MCP SDK) reach node builtins at runtime.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __browsenticCreateRequire } from 'node:module';",
      'const require = __browsenticCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
