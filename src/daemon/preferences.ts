/**
 * The settings two surfaces share: the extension's settings page and the desktop app both read
 * and write them here, and config.json is the only copy. A change from either side, from the
 * CLI, or from a hand edit of the file reaches every open surface through `watchConfig`.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, watch } from 'node:fs';
import { basename } from 'node:path';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { isPreferenceChange, type Preferences } from '@/lib/settings/preferences';
import { configPath, readAgentConfig, writeGuardrailSetting, writeTheme } from './agent/config';
import { guardrailSettings, settingWritable } from './guardrails';
import { log } from './log';
import { stateDir } from './paths';

const SETTLE_MS = 150;
const CONFIG_FILE = basename(configPath);

export function preferencesNow(): Preferences {
  const config = readAgentConfig();
  return {
    theme: config.theme ?? null,
    guardrails: guardrailSettings(config.guardrails ?? {}, config.requireApproval, configPath),
  };
}

export function applyPreference(change: unknown): ActionResult<Preferences> {
  if (!isPreferenceChange(change)) {
    return failure('INVALID_INPUT', 'Expected {kind:"theme", theme} or {kind:"guardrail", setting, value}.');
  }
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

/** What config.json holds right now, and the part of it a change of agent or model moves. */
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
  return { file: createHash('sha256').update(text).digest('hex'), agent: JSON.stringify([agent, agents]) };
}

/**
 * Calls back once config.json settles after a write from anywhere. The directory is watched,
 * not the file, because an editor that saves by replacing the file would end a file watch.
 */
export function watchConfig(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const watcher = watch(stateDir, (_event, name) => {
      if (name !== null && String(name) !== CONFIG_FILE) return;
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
