// Writes the latest.json every installed Windows app polls (tauri.conf.json → plugins.updater): the
// version, and for each architecture the installer's URL on the GitHub release and the signature the
// app checks it against. The release workflow runs it once both installers are attached:
//
//   node scripts/windows-latest-json.ts <version> <folder with the .sig files> > latest.json

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'imshaikot/browsentic';
const ARCHITECTURES = { 'windows-x86_64': 'x64', 'windows-aarch64': 'arm64' } as const;

const [version, signatures] = process.argv.slice(2);
if (!version || !signatures) {
  console.error('usage: windows-latest-json.ts <version> <folder with the .sig files>');
  process.exit(1);
}

const installerName = (release: string, arch: string) => `Browsentic-${release}-${arch}-setup.exe`;

const platforms = Object.fromEntries(
  Object.entries(ARCHITECTURES).map(([platform, arch]) => {
    const installer = installerName(version, arch);
    return [
      platform,
      {
        signature: readFileSync(join(signatures, `${installer}.sig`), 'utf8').trim(),
        url: `https://github.com/${REPO}/releases/download/v${version}/${installer}`,
      },
    ];
  }),
);

const feed = {
  version,
  notes: `https://github.com/${REPO}/releases/tag/v${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

process.stdout.write(`${JSON.stringify(feed, null, 2)}\n`);
