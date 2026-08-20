/**
 * Standing approvals: "Allow for this site", remembered.
 *
 * A grant is a pair — one action, one host — recorded because the user answered an
 * approval card with "always on this site". It only ever short-circuits a `confirm`;
 * a `deny` stays denied, because those are the rules the user cannot click past.
 *
 * Kept out of config.json on purpose. Config is hand-edited and declarative; this file
 * accumulates from clicks, and mixing the two would make a hand-written policy hard to
 * read and easy to clobber.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from '../lockfile';
import { log } from '../log';

export interface Grant {
  readonly action: string;
  readonly host: string;
  readonly at: string;
}

const approvalsPath = join(stateDir, 'approvals.json');
const MAX_GRANTS = 200;

function read(): Grant[] {
  try {
    const parsed = JSON.parse(readFileSync(approvalsPath, 'utf8')) as { grants?: unknown };
    if (!Array.isArray(parsed.grants)) return [];
    return parsed.grants.filter(
      (grant): grant is Grant =>
        !!grant &&
        typeof (grant as Grant).action === 'string' &&
        typeof (grant as Grant).host === 'string' &&
        typeof (grant as Grant).at === 'string',
    );
  } catch {
    return [];
  }
}

function write(grants: readonly Grant[]): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(approvalsPath, `${JSON.stringify({ grants }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(approvalsPath, 0o600);
}

export function listGrants(): Grant[] {
  return read();
}

export function isGranted(action: string, host: string): boolean {
  return read().some((grant) => grant.action === action && grant.host === host);
}

export function rememberGrant(action: string, host: string, at: string): void {
  const kept = read().filter((grant) => !(grant.action === action && grant.host === host));
  write([{ action, host, at }, ...kept].slice(0, MAX_GRANTS));
  log(`remembered approval: ${action} on ${host}`);
}

export function forgetGrants(host?: string): number {
  const grants = read();
  const kept = host ? grants.filter((grant) => grant.host !== host) : [];
  write(kept);
  return grants.length - kept.length;
}
