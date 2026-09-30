/** Kept out of config.json so the config stays safe to paste into a bug report. */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asUserProfile, EMPTY_PROFILE, isEmptyProfile, isUserProfile, normalizeProfile, type UserProfile } from '@/lib/settings/profile';
import { log } from './log';
import { stateDir } from './paths';

export const profilePath = join(stateDir, 'profile.json');

export function readProfileText(): string {
  try {
    return readFileSync(profilePath, 'utf8');
  } catch {
    return '';
  }
}

export function readProfile(): UserProfile {
  const text = readProfileText();
  if (!text) return EMPTY_PROFILE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    log(`${profilePath} is not JSON; the agent runs without a profile until it is fixed or saved again`);
    return EMPTY_PROFILE;
  }
  if (!isUserProfile(parsed)) log(`${profilePath} has entries the settings page cannot hold; they are left out`);
  return asUserProfile(parsed);
}

export function writeProfile(profile: UserProfile): void {
  if (isEmptyProfile(profile)) {
    rmSync(profilePath, { force: true });
    return;
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(profilePath, `${JSON.stringify(normalizeProfile(profile), null, 2)}\n`, { mode: 0o600 });
}
