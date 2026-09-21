import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = 'https://github.com/imshaikot/browsentic';

const [xpi, out = 'dist/updates.json'] = process.argv.slice(2);
if (!xpi) {
  console.error(
    'usage: node scripts/firefox-updates.ts <signed.xpi> [out.json]\n' +
      'Writes the update manifest Firefox polls, for the build in dist/firefox-mv2 and the .xpi Mozilla signed from it.',
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync('dist/firefox-mv2/manifest.json', 'utf8')) as {
  version: string;
  browser_specific_settings: { gecko: { id: string; strict_min_version: string } };
};
const { version } = manifest;
const { id, strict_min_version } = manifest.browser_specific_settings.gecko;
const update_link = `${REPO}/releases/download/v${version}/browsentic-${version}-firefox.xpi`;
const update_hash = `sha256:${createHash('sha256').update(readFileSync(xpi)).digest('hex')}`;

const updates = {
  addons: {
    [id]: { updates: [{ version, update_link, update_hash, applications: { gecko: { strict_min_version } } }] },
  },
};

writeFileSync(out, `${JSON.stringify(updates, null, 2)}\n`);
console.log(`${out}: ${id} ${version} → ${update_link}`);
