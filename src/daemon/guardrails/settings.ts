/**
 * Describing the policy to the panel that renders it.
 *
 * Everything here is derived from `DEFAULT_RULES` and the live config, so a rule added
 * to the policy appears in the settings screen with no second edit — and a rule whose
 * title or reason changes says the new thing in both places.
 *
 * `fallback` is the effect this install would use with nothing overridden, which is not
 * always the shipped constant: `form-submission` takes its default from the legacy
 * `requireApproval` key. Computing it by re-running `policyFrom` without the rule
 * overrides is the only way to get that right without restating the derivation.
 */

import {
  FENCE_SETTING,
  UNATTENDED_SETTING,
  isRuleEffect,
  type GuardrailSettings,
  type GuardrailToggle,
  type GuardrailValue,
  type RuleEffect,
} from '@/lib/settings/guardrails';
import { DEFAULT_RULES, policyFrom, type GuardrailConfig } from './policy';

/**
 * Not preferences. Allowing `javascript:` navigation, letting a page call an internal
 * verb, or letting a released credential travel in a query string have no use worth a
 * switch someone can hit by accident. Hand-editing config.json still works.
 */
const LOCKED = new Set(['reserved-action', 'non-http-navigation', 'secret-in-url']);

const RULE_IDS = new Set(DEFAULT_RULES.map((rule) => rule.id));

export function guardrailSettings(
  config: GuardrailConfig,
  requireApproval: readonly string[],
  configPath: string,
): GuardrailSettings {
  const overrides = config.rules ?? {};
  const baseline = policyFrom({ ...config, rules: {} }, requireApproval);

  const rules: GuardrailToggle[] = baseline.rules.map((rule) => {
    const override = overrides[rule.id];
    return {
      id: rule.id,
      title: rule.title,
      reason: rule.reason,
      fallback: rule.effect,
      ...(isRuleEffect(override) ? { override } : {}),
      ...(LOCKED.has(rule.id) ? { locked: true } : {}),
    };
  });

  return {
    rules,
    fence: { enabled: config.fence !== false, overridden: config.fence !== undefined },
    unattended: {
      effect: config.unattended === 'allow' ? 'allow' : 'deny',
      overridden: config.unattended !== undefined,
    },
    hosts: config.hosts ?? [],
    configPath,
  };
}

/** Whether the panel may write this setting at all, and whether the value fits it. */
export function settingWritable(setting: string, value: GuardrailValue): boolean {
  if (setting === FENCE_SETTING) return value === null || typeof value === 'boolean';
  if (setting === UNATTENDED_SETTING) return value === null || value === 'allow' || value === 'deny';
  if (!RULE_IDS.has(setting) || LOCKED.has(setting)) return false;
  return value === null || isRuleEffect(value);
}

export function ruleEffect(value: GuardrailValue): RuleEffect | null {
  return isRuleEffect(value) ? value : null;
}
