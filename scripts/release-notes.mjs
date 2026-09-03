#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = 'imshaikot/browsentic';

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
    '```sh',
    `npx browsentic@${version} setup`,
    '```',
    '',
    'That installs the extension, starts the daemon and prints a pairing code. Then load the folder',
    'it names at `chrome://extensions` with **Developer mode** on, and paste the code into the popup.',
    '',
    'Already running an older version? `npx browsentic@latest update` refreshes the extension in',
    'place and keeps your browser paired. Press ↻ on the Browsentic card afterwards.',
    '',
    '<details><summary>From the zips, or from source</summary>',
    '',
    `The \`-chrome.zip\` and \`-firefox.zip\` below are the same builds, for loading by hand. Firefox`,
    'needs Developer Edition or Nightly, since release Firefox refuses unsigned extensions.',
    '',
    '```sh',
    `git clone --branch v${version} https://github.com/${REPO}.git`,
    'cd browsentic && yarn setup && yarn daemon:link',
    'browsentic setup',
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
