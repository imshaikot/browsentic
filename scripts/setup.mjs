#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Run the release .yarnrc.yml pins rather than whatever is on PATH — same reasoning as
// yarnPath itself, except a fresh clone has no node_modules yet, so `yarn run` is not
// available to re-exec us. Invoking the vendored release through node needs nothing but node.
function yarn() {
  const rc = join(root, '.yarnrc.yml');
  const pinned = existsSync(rc) && /^yarnPath:\s*(\S+)/m.exec(readFileSync(rc, 'utf8'))?.[1];
  if (pinned && existsSync(join(root, pinned))) return [process.execPath, [join(root, pinned)]];
  return ['yarn', []];
}

// mcp/ is a separate Yarn project (its own lockfile), so the root install does not cover it.
const STEPS = [
  ['extension dependencies', ['install']],
  ['extension build', ['build']],
  ['daemon dependencies', ['--cwd', 'mcp', 'install']],
  ['daemon build', ['--cwd', 'mcp', 'build']],
];

const [bin, prefix] = yarn();
if (bin !== process.execPath) {
  console.warn('! no vendored Yarn release found — falling back to `yarn` on PATH');
}

STEPS.forEach(([label, args], i) => {
  console.log(`\n\x1b[1m▸ ${i + 1}/${STEPS.length}  ${label}\x1b[0m`);
  const r = spawnSync(bin, [...prefix, ...args], { cwd: root, stdio: 'inherit' });
  if (r.error) {
    // Nothing was launched at all — no status to report. Almost always a missing `yarn`
    // on PATH after the vendored release failed to resolve.
    console.error(`\n\x1b[31m✗ could not run \`${bin}\`: ${r.error.message}\x1b[0m`);
    console.error(`  Expected the pinned release at .yarn/releases/ — run this from inside the repo.\n`);
    process.exit(1);
  }
  if (r.status !== 0) {
    // status is null when a signal killed it, so report whichever one actually happened.
    const how = r.signal ? `killed by ${r.signal}` : `exited ${r.status}`;
    console.error(`\n\x1b[31m✗ ${label} failed — \`yarn ${args.join(' ')}\` ${how}\x1b[0m\n`);
    process.exit(r.status || 1);
  }
});

console.log(`
\x1b[32m✓ Extension built\x1b[0m  dist/chrome-mv3 — load it unpacked at chrome://extensions, Developer mode on
\x1b[32m✓ Daemon built\x1b[0m     mcp/dist

Two steps are left. Both reach outside this directory, so they stay separate:

  yarn mcp:link         puts \`browsentic\` on your PATH (writes to the global npm prefix)
  browsentic pair       prints a single use code, valid for 10 minutes
`);
