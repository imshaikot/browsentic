#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = 'imshaikot/browsentic';
const CHROME_WEB_STORE = 'https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp';

const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['test', 'Tests'],
  ['build', 'Build'],
  ['ci', 'CI'],
  ['chore', 'Chores'],
];

const SECTION_CAP = 20;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitTry = (...args) => {
  try {
    return git(...args);
  } catch {
    return '';
  }
};

/**
 * `prepare` writes the notes into the annotated tag object, so a tag cut that way already
 * carries the text that should ship, hand-edits included. Only an annotated tag has its own
 * message: on a lightweight one the format would return the commit's message, which would
 * publish a commit body as release notes. A signed tag's payload ends with the signature
 * block, and git (through 2.50 at least) only splits PGP ones out of `contents:body` —
 * v0.4.11 published its SSH signature as the last lines of the notes — so strip it here.
 */
const TRAILING_SIGNATURE = /-----BEGIN (PGP|SSH) SIGNATURE-----[\s\S]*?-----END \1 SIGNATURE-----\s*$/;

function annotatedBody(tag) {
  if (gitTry('cat-file', '-t', tag) !== 'tag') return null;
  const body = gitTry('tag', '-l', '--format=%(contents:body)', tag).replace(TRAILING_SIGNATURE, '');
  return body.trim() || null;
}

function commitsSince(prevTag, tag) {
  const raw = gitTry('log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', prevTag ? `${prevTag}..${tag}` : tag);
  if (!raw) return [];
  return raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => !/\x1fchore\(release\):/.test(chunk))
    .map((chunk) => {
      const [hash, subject, body = ''] = chunk.split('\x1f');
      const m = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject);
      return {
        short: hash.slice(0, 7),
        subject,
        type: m ? m[1] : null,
        scope: m ? m[2] || null : null,
        breaking: !!(m && m[3]) || /^BREAKING[ -]CHANGE:/m.test(body),
        text: m ? m[4] : subject,
      };
    });
}

function renderNotes(version, commits, prevTag) {
  const lines = [];
  const bullet = (c) => `- ${c.scope ? `**${c.scope}**: ` : ''}${c.text} (${c.short})`;
  const section = (title, hits, render = bullet) => {
    if (!hits.length) return;
    lines.push(`### ${title}`, '');
    for (const c of hits.slice(0, SECTION_CAP)) lines.push(render(c));
    if (hits.length > SECTION_CAP) lines.push(`- _… and ${hits.length - SECTION_CAP} more_`);
    lines.push('');
  };

  if (!prevTag) lines.push('First tagged release. Everything in the repo to date, summarized.', '');
  section('Breaking changes', commits.filter((c) => c.breaking));
  for (const [type, title] of SECTIONS) {
    section(title, commits.filter((c) => c.type === type && !c.breaking));
  }
  section(
    'Other',
    commits.filter((c) => !c.breaking && !SECTIONS.some(([t]) => t === c.type)),
    (c) => `- ${c.subject} (${c.short})`,
  );
  if (!commits.length) lines.push('_No commits since the last release._', '');

  lines.push(
    '### Install',
    '',
    'Browsentic is two pieces plus the AI you already use. Install the first two in either order, then pair them once with a code.',
    '',
    '**1. The extension**, in your browser:',
    '',
    `- **Chrome, Edge, Brave, Arc, Vivaldi, Opera** — [Chrome Web Store](${CHROME_WEB_STORE}). In Edge, press **Allow extensions from other stores** first. It updates itself.`,
    `- **Firefox 140 or newer** — \`browsentic-${version}-firefox.xpi\` below, signed by Mozilla. Open it in Firefox and accept both prompts; it updates itself.`,
    '',
    '**2. Browsentic Bridge**, on your computer. It runs your agent and keeps everything local.',
    '',
    '**macOS** — installs the app, and the app installs everything else, Node included:',
    '',
    '```sh',
    'curl -fsSL https://browsentic.com/install.sh | sh',
    '```',
    '',
    `The \`Browsentic-${version}.dmg\` below is the same app. It is not notarized yet, so a downloaded copy is blocked`,
    'on first open: **System Settings → Privacy & Security → Open Anyway**. The line above avoids that.',
    '',
    '**Windows 10 or 11** (experimental) — installs the app, and the app installs everything else, Node included:',
    '',
    '```powershell',
    'irm https://browsentic.com/install.ps1 | iex',
    '```',
    '',
    `The \`Browsentic-${version}-x64-setup.exe\` and \`-arm64-setup.exe\` below are the same app. They are not code-signed`,
    'yet, so SmartScreen warns on a downloaded copy: **More info → Run anyway**. The line above avoids that.',
    '',
    '**Any platform** — macOS, Windows or Linux, with Node.js 20 or newer:',
    '',
    '```sh',
    `npx browsentic@${version} setup`,
    '```',
    '',
    'It asks which browser should get the extension, opens its store page there, and prints a pairing code.',
    'The apps do the same from their Overview tab.',
    '',
    '**3. An agent CLI you are signed in to** — Claude Code, Codex, or another supported one.',
    '',
    'Then click Browsentic in the toolbar and enter the pairing code, once.',
    '',
    'Already running an older version? The Mac and Windows apps offer the update on their Overview tab, and',
    '`npx browsentic@latest update` updates the Bridge from a terminal. Your browser stays paired, and the',
    'extension and the Bridge do not have to be the same version. Only an unpacked copy needs ↻ on its card.',
    '',
    '<details><summary>Load it unpacked, from the zips, or from source</summary>',
    '',
    `For a browser that cannot reach a store: \`npx browsentic@${version} setup --unpacked\` writes the extension to a`,
    'folder and prints the steps to load it with **Developer mode** on.',
    '',
    `The \`-chrome.zip\` and \`-firefox.zip\` below are the same builds, for loading by hand. Release Firefox`,
    'installs only the signed `.xpi`; the zip is for Developer Edition or Nightly.',
    '',
    '```sh',
    `git clone --branch v${version} https://github.com/${REPO}.git`,
    'cd browsentic && yarn setup && yarn daemon:link',
    'browsentic setup --unpacked',
    '```',
    '',
    '</details>',
    '',
    prevTag
      ? `**Full changelog**: https://github.com/${REPO}/compare/${prevTag}...v${version}`
      : `**Full changelog**: https://github.com/${REPO}/commits/v${version}`,
  );
  return lines.join('\n');
}

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt === -1 ? null : args[outAt + 1];
const version = (outAt === 0 ? args[2] : args[0])?.replace(/^v/, '');

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: release-notes.mjs <version> [--out <file>]');
  process.exit(1);
}

const tag = `v${version}`;
const prevTag = gitTry('describe', '--tags', '--abbrev=0', `${tag}^`) || null;
const notes = annotatedBody(tag) ?? renderNotes(version, commitsSince(prevTag, tag), prevTag);

if (out) {
  writeFileSync(out, `${notes}\n`);
  console.error(`notes for ${tag} → ${out}`);
} else {
  process.stdout.write(`${notes}\n`);
}
