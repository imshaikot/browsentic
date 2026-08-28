/**
 * The evaluator. Pure: same request and policy in, same decision out.
 *
 * Every rule whose condition matches is collected and the most severe effect wins, so
 * the decision does not depend on the order rules are declared in.
 */

import { failure, type ActionResult } from '@/lib/actions/protocol';
import { CONDITIONS, POLICY, type Effect, type GuardrailRequest, type Policy, type Rule } from './policy';

const SEVERITY: Record<Effect, number> = { allow: 0, confirm: 1, deny: 2 };

/** Kept verbatim: the run preamble tells the agent what DECLINED means and to stop. */
export const DECLINED_MESSAGE =
  'The user declined this action. Do not retry it and do not try to achieve the same effect another way. Tell the user it was declined and stop.';

export interface Decision {
  /** Fully resolved: an `external` caller never gets `confirm`, since it cannot answer one. */
  readonly effect: Effect;
  /**
   * The rules that decided this. `allow` with a non-empty `matched` means gated rules
   * fired but were waived because the caller had no one to ask — worth logging.
   */
  readonly matched: readonly Rule[];
  /** What to tell the agent. Empty when nothing is being refused. */
  readonly reason: string;
}

const ALLOWED: Decision = { effect: 'allow', matched: [], reason: '' };

export function decide(request: GuardrailRequest, policy: Policy = POLICY): Decision {
  const matched = policy.rules.filter(
    (rule) => rule.effect !== 'allow' && CONDITIONS[rule.when](request, policy),
  );
  if (!matched.length) return ALLOWED;

  const worst = matched.reduce<Effect>(
    (severest, rule) => (SEVERITY[rule.effect] > SEVERITY[severest] ? rule.effect : severest),
    'allow',
  );
  const decisive = matched.filter((rule) => rule.effect === worst);
  const reason = decisive.map((rule) => rule.reason).join(' ');

  // A caller with no human attached cannot answer a confirm, so the policy answers for it.
  if (worst === 'confirm' && request.caller === 'external') {
    if (policy.unattended === 'allow') return { effect: 'allow', matched: decisive, reason: '' };
    return {
      effect: 'deny',
      matched: decisive,
      reason: `${reason} Actions that need approval are only available from the Browsentic side panel, where the user can see and answer them.`,
    };
  }

  return { effect: worst, matched: decisive, reason };
}

/** Rule ids behind a decision, for the daemon log. */
export function describe(decision: Decision): string {
  return decision.matched.map((rule) => rule.id).join(', ');
}

/** One line for the approval prompt in the side panel. */
export function summary(decision: Decision): string {
  return decision.matched.map((rule) => rule.title).join(' · ');
}

export function blocked(decision: Decision): ActionResult {
  return failure('BLOCKED', `${decision.reason} Tell the user what you were about to do and why it was blocked, then stop.`);
}

export function declined(): ActionResult {
  return failure('DECLINED', DECLINED_MESSAGE);
}
