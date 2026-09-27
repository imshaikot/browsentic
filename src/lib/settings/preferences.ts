/**
 * Everything a person can set from either the extension's settings page or the Mac app. The
 * daemon keeps it in config.json and hands the same snapshot to both, after every change,
 * whichever side made it — or a hand edit of the file.
 */

import { isThemeId, type ThemeId } from './theme';
import { isRuleEffect, type GuardrailSettings, type GuardrailValue } from './guardrails';

export interface Preferences {
  /** Null until someone picks one; a browser that already has a choice then hands it over. */
  readonly theme: ThemeId | null;
  readonly guardrails: GuardrailSettings;
}

export type PreferenceChange =
  | { readonly kind: 'theme'; readonly theme: ThemeId }
  | { readonly kind: 'guardrail'; readonly setting: string; readonly value: GuardrailValue };

export function isPreferenceChange(value: unknown): value is PreferenceChange {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as { kind?: unknown; theme?: unknown; setting?: unknown; value?: unknown };
  if (change.kind === 'theme') return isThemeId(change.theme);
  return (
    change.kind === 'guardrail' &&
    typeof change.setting === 'string' &&
    (change.value === null || typeof change.value === 'boolean' || isRuleEffect(change.value))
  );
}
