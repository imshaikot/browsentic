// Stages what the Windows app carries, the way src/mac/Scripts/build-app.sh stages the macOS one:
// the npm package's layout under resources/payload (cli.js resolves ../skills and ../extension
// from dist/), and the browsentic.exe launcher under resources/launcher. Tauri runs it before every
// build, with the target it is building for in TAURI_ENV_TARGET_TRIPLE.
//
// It builds nothing of the extension or the daemon: `yarn build && yarn daemon:build` come first,
// and a payload whose versions disagree is refused rather than shipped.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const daemon = join(root, 'src/daemon');
const extension = join(root, 'dist/chrome-mv3');
const workspace = join(root, 'src/windows');
const resources = join(workspace, 'src-tauri/resources');

function die(problem: string, fix: string): never {
  console.error(`windows-payload: ${problem}\n  ${fix}`);
  process.exit(1);
}

const versionOf = (manifest: string) => JSON.parse(readFileSync(manifest, 'utf8')).version as string;

if (!existsSync(join(extension, 'manifest.json'))) die('no extension build at dist/chrome-mv3', 'Run `yarn build` at the repository root first.');
if (!existsSync(join(daemon, 'dist/cli.js'))) die('no daemon build at src/daemon/dist/cli.js', 'Run `yarn daemon:build` first.');

const version = versionOf(join(daemon, 'package.json'));
const built = versionOf(join(extension, 'manifest.json'));
if (built !== version) die(`the built extension is ${built} but the package is ${version}`, 'Rebuild it after bumping the version: `yarn build`.');
if (!readFileSync(join(daemon, 'dist/cli.js'), 'utf8').includes(`"${version}"`)) {
  die(`src/daemon/dist/cli.js was not built from ${version}`, 'Run `yarn daemon:build`.');
}

rmSync(resources, { recursive: true, force: true });
const payload = join(resources, 'payload');
mkdirSync(join(payload, 'dist'), { recursive: true });
for (const file of ['cli.js', 'daemon-main.js']) cpSync(join(daemon, 'dist', file), join(payload, 'dist', file));
cpSync(join(daemon, 'skills'), join(payload, 'skills'), { recursive: true });
cpSync(extension, join(payload, 'extension/chrome-mv3'), { recursive: true });
for (const file of ['package.json', 'LICENSE']) cpSync(join(daemon, file), join(payload, file));

const target = process.env.TAURI_ENV_TARGET_TRIPLE;
const forWindows = target ? target.includes('windows') : process.platform === 'win32';
const crossing = forWindows && process.platform !== 'win32';
const cargo = [...(crossing ? ['xwin'] : []), 'build', '--release', '--package', 'browsentic-launcher', ...(target ? ['--target', target] : [])];
execFileSync('cargo', cargo, { cwd: workspace, stdio: 'inherit', env: { ...process.env, XWIN_ACCEPT_LICENSE: process.env.XWIN_ACCEPT_LICENSE ?? '1' } });

const launcher = forWindows ? 'browsentic.exe' : 'browsentic';
const release = join(workspace, 'target', target ?? '', 'release', launcher);
mkdirSync(join(resources, 'launcher'), { recursive: true });
cpSync(release, join(resources, 'launcher', launcher));

console.log(`windows-payload: v${version} staged for ${target ?? 'this machine'}`);
