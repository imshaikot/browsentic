import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { installKind, npxEntries, pinnedVersion } from './npx';

const REGISTRY = process.env.BROWSENTIC_REGISTRY ?? 'https://registry.npmjs.org';

/** The published version, or null when the registry is unreachable — offline is not an error here. */
export async function publishedVersion(timeoutMs = 4_000): Promise<string | null> {
  try {
    const response = await fetch(`${REGISTRY}/browsentic/latest`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const manifest = (await response.json()) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

export function isNewer(candidate: string, current: string): boolean {
  const release = (version: string) => version.split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [release(candidate), release(current)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);

  // Same release: a final beats the prerelease that led to it, and two prereleases fall back
  // to string order, which is right for the -rc.1 / -rc.2 shape this project actually uses.
  const [pre, currentPre] = [candidate.split('-')[1], current.split('-')[1]];
  if (pre === currentPre) return false;
  if (!pre) return true;
  if (!currentPre) return false;
  return pre > currentPre;
}

/**
 * Replace this CLI with the published one, then re-run the original command under it.
 *
 * Returns the exit code of that second run, or null when nothing needed doing — the caller
 * exits on a number and carries on otherwise.
 *
 * The reason this exists: a stale CLI installs a stale extension, silently and for as long as
 * the cache lives. `update` and `setup` both promise the current build, so both have to be
 * able to reach past whatever is pinning them.
 */
export async function upgradeCli(current: string, forward: string[]): Promise<number | null> {
  const pinned = pinnedVersion();
  if (pinned) return null;

  const latest = await publishedVersion();
  if (!latest || !isNewer(latest, current)) return null;

  const kind = installKind();
  // stderr throughout: `setup --json` promises a parseable stdout, and progress is not part of it.
  if (kind === 'repo') {
    console.error(`\n  ! browsentic ${latest} is published; this is ${current}, from a source checkout.`);
    console.error(`    Update it with "git pull && yarn setup".\n`);
    return null;
  }

  if (kind === 'app') {
    console.error(`\n  ! browsentic ${latest} is published; this is ${current}, installed by Browsentic.app.`);
    console.error(`    Update it from the app, which replaces the command and the extension together.\n`);
    return null;
  }

  console.error(`\n  ↻ Updating the command itself, ${current} → ${latest}\n`);
  const rerun = [...forward, '--no-self-update'];

  if (kind === 'npx') {
    // Every entry, not just ours: they are all stale by definition now, and the next bare
    // `npx browsentic` would otherwise pick one of them back up.
    for (const entry of npxEntries()) rmSync(entry.dir, { recursive: true, force: true });
    const code = run('npx', ['-y', `browsentic@${latest}`, ...rerun]);
    if (code !== 0) {
      console.error(`\n  That did not run, but nothing is broken: the cache is cleared, so a plain`);
      console.error(`  \`npx browsentic ${forward[0] ?? 'setup'}\` fetches ${latest} fresh next time.\n`);
    }
    return code;
  }

  const installed = run('npm', ['install', '-g', `browsentic@${latest}`]);
  if (installed !== 0) {
    console.error(`\n  Could not replace the global install. Run this yourself, then try again:\n`);
    console.error(`      npm install -g browsentic@${latest}\n`);
    return installed;
  }
  return run('browsentic', rerun);
}

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`\n  Could not run \`${command}\`: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}
