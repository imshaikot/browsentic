/**
 * The settings two surfaces share: the extension's settings page and the desktop app both read
 * and write them here, and config.json — with profile.json beside it — is the only copy. A change
 * from either side, from the CLI, or from a hand edit of either file reaches every open surface
 * through `watchConfig`.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, watch } from 'node:fs';
import { basename } from 'node:path';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { findSecrets } from '@/lib/secrets';
import { isPreferenceChange, type Preferences } from '@/lib/settings/preferences';
import { normalizeProfile, PROFILE_FIELDS, sameProfile, type UserProfile } from '@/lib/settings/profile';
import { configPath, readAgentConfig, writeGuardrailSetting, writeTheme } from './agent/config';
import { guardrailSettings, settingWritable } from './guardrails';
import { log } from './log';
import { stateDir } from './paths';
import { profilePath, readProfile, readProfileText, writeProfile } from './profile';

const SETTLE_MS = 150;
const WATCHED = [basename(configPath), basename(profilePath)];

export function preferencesNow(): Preferences {
  const config = readAgentConfig();
  return {
    theme: config.theme ?? null,
    guardrails: guardrailSettings(config.guardrails ?? {}, config.requireApproval, configPath),
    profile: readProfile(),
  };
}

export function applyPreference(change: unknown): ActionResult<Preferences> {
  if (!isPreferenceChange(change)) {
    return failure('INVALID_INPUT', 'Expected {kind:"theme", theme}, {kind:"guardrail", setting, value} or {kind:"profile", profile}.');
  }
  if (change.kind === 'profile') return saveProfile(change.profile);
  if (change.kind === 'theme') {
    if (readAgentConfig().theme !== change.theme) {
      writeTheme(change.theme);
      log(`theme → ${change.theme}`);
    }
    return success(preferencesNow());
  }
  if (!settingWritable(change.setting, change.value)) {
    return failure(
      'INVALID_INPUT',
      `"${change.setting}" is not a guardrail the settings screen may set. Locked rules are edited in ${configPath}.`,
    );
  }
  writeGuardrailSetting(change.setting, change.value);
  log(`guardrail ${change.setting} → ${change.value === null ? 'default' : String(change.value)}`);
  return success(preferencesNow());
}

function saveProfile(profile: UserProfile): ActionResult<Preferences> {
  const next = normalizeProfile(profile);
  const secret = secretIn(next);
  if (secret) {
    return failure(
      'INVALID_INPUT',
      `“${secret}” looks like a password, key or card number. Browsentic keeps those sealed in the browser and never hands them to a model — leave it out of your profile.`,
    );
  }
  if (!sameProfile(next, readProfile())) {
    writeProfile(next);
    log(`profile saved (${Object.keys(next.fields).length + next.details.length} details, ${next.instructions ? 'with' : 'no'} instructions)`);
  }
  return success(preferencesNow());
}

function secretIn(profile: UserProfile): string | undefined {
  const entries = [
    ...PROFILE_FIELDS.map(({ id, label }) => ({ label, text: profile.fields[id] ?? '', phone: id === 'phone' })),
    ...profile.details.map(({ label, value }) => ({ label, text: `${label}: ${value}`, phone: false })),
    { label: 'Instructions', text: profile.instructions, phone: false },
  ];
  return entries.find(({ text, phone }) => findSecrets(text).some((span) => !(phone && span.kind === 'card')))?.label;
}

/** What config.json and profile.json hold right now, and the part of it a change of agent or model moves. */
export interface ConfigMark {
  file: string;
  agent: string;
}

export function markConfig(): ConfigMark {
  let text = '';
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    // No file is a state of its own: every setting at its default.
  }
  const { agent, agents } = readAgentConfig();
  const file = createHash('sha256').update(text).update('\0').update(readProfileText()).digest('hex');
  return { file, agent: JSON.stringify([agent, agents]) };
}

/**
 * Calls back once config.json or profile.json settles after a write from anywhere. The directory
 * is watched, not the files, because an editor that saves by replacing a file would end a file watch.
 */
export function watchConfig(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const watcher = watch(stateDir, (_event, name) => {
      if (name !== null && !WATCHED.includes(String(name))) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, SETTLE_MS);
    });
    watcher.on('error', (error) => log(`stopped watching ${configPath}: ${String(error)}`));
    watcher.unref();
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch (error) {
    log(`not watching ${configPath}, so a hand edit applies at the next change: ${String(error)}`);
    return () => undefined;
  }
}
