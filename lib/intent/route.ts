import { RULES, type Rule } from './grammar';
import { normalize } from './normalize';

/**
 * Score at which the extension acts on its own instead of waking the agent. Set from the
 * fixture table in `scripts/check-intent.mjs` — raise it and more quick commands take the
 * slow path, lower it and the grammar starts guessing. Every miss is recoverable (a failed
 * local action escalates), so the cost of being wrong is a round trip, not a wrong click.
 */
export const ACT_THRESHOLD = 0.75;

/** Why an utterance went to the agent. Surfaced for debugging, not shown to the user. */
export type EscalationReason =
  | 'no-match'
  | 'below-threshold'
  | 'question'
  | 'multi-step'
  | 'conditional'
  | 'consequential'
  | 'skill-prefix';

export interface LocalIntent {
  /** The rule that matched, e.g. "navigate.url". */
  ruleId: string;
  /** Registry action name — the same call the agent would have made. */
  action: string;
  input: unknown;
  /** One line for the timeline, e.g. "Go back". */
  label: string;
  score: number;
}

export type Routing =
  | { decision: 'act'; intent: LocalIntent }
  | { decision: 'escalate'; reason: EscalationReason; score: number; ruleId?: string };

/** An utterance in question form is asking for an answer, which only the agent can give. */
const QUESTION =
  /^(?:what|whats|why|how|who|when|where|which|is|are|was|were|do|does|did|can|could|should|would|tell|explain|describe|summarize|summarise|read|find|show|check|look|see|list|compare|help|write|draft|fill)\b/;

/** Two commands in one sentence. The grammar handles one thing at a time. */
const MULTI_STEP = /\b(?:and then|then|after that|and also|followed by)\b/;

/** A condition to evaluate, which means looking at the page and deciding — the agent's job. */
const HEDGE = /\b(?:if|unless|whenever|maybe|might|try to|see if|as soon as|in case|otherwise)\b/;

/**
 * Decide whether the extension can carry out an utterance itself.
 *
 * The funnel is deliberately biased toward escalating: a false "act" spends a wrong action on
 * the user's real page, while a false "escalate" only costs the round trip this exists to
 * avoid. Hard stops come first (questions, multiple steps, consequential clicks), then the
 * highest-scoring rule has to clear {@link ACT_THRESHOLD}.
 */
export function routeIntent(input: string): Routing {
  const utterance = normalize(input);
  // "@skill do the thing" is an explicit request for a particular agent skill.
  if (utterance.raw.startsWith('@')) return escalate('skill-prefix', 0);
  if (!utterance.text) return escalate('no-match', 0);
  if (utterance.question || QUESTION.test(utterance.text)) return escalate('question', 0);
  if (MULTI_STEP.test(utterance.text)) return escalate('multi-step', 0);
  if (HEDGE.test(utterance.text)) return escalate('conditional', 0);

  let best: { rule: Rule; score: number; label: string; input: unknown; risky: boolean } | null = null;
  for (const rule of RULES) {
    const match = rule.pattern.exec(utterance.text);
    if (!match) continue;
    const slot = rule.build(match.groups ?? {});
    if (!slot) continue;
    const score = round(rule.certainty * slot.confidence);
    if (!best || score > best.score) {
      best = { rule, score, label: slot.label, input: slot.input, risky: slot.risky === true };
    }
  }

  if (!best) return escalate('no-match', 0);
  if (best.risky) return escalate('consequential', best.score, best.rule.id);
  if (best.score < ACT_THRESHOLD) return escalate('below-threshold', best.score, best.rule.id);
  return {
    decision: 'act',
    intent: {
      ruleId: best.rule.id,
      action: best.rule.action,
      input: best.input,
      label: best.label,
      score: best.score,
    },
  };
}

const escalate = (reason: EscalationReason, score: number, ruleId?: string): Routing => ({
  decision: 'escalate',
  reason,
  score,
  ruleId,
});

const round = (n: number) => Math.round(n * 1000) / 1000;
