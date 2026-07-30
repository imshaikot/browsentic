import { RULES, type Rule } from './grammar';
import { normalize } from './normalize';

export const ACT_THRESHOLD = 0.75;

export type EscalationReason =
  | 'no-match'
  | 'below-threshold'
  | 'question'
  | 'multi-step'
  | 'conditional'
  | 'consequential'
  | 'skill-prefix';

export interface LocalIntent {
  ruleId: string;
  action: string;
  input: unknown;
  label: string;
  score: number;
}

export type Routing =
  | { decision: 'act'; intent: LocalIntent }
  | { decision: 'escalate'; reason: EscalationReason; score: number; ruleId?: string };

const QUESTION =
  /^(?:what|whats|why|how|who|when|where|which|is|are|was|were|do|does|did|can|could|should|would|tell|explain|describe|summarize|summarise|read|find|show|check|look|see|list|compare|help|write|draft|fill)\b/;

const MULTI_STEP = /\b(?:and then|then|after that|and also|followed by)\b/;

const HEDGE = /\b(?:if|unless|whenever|maybe|might|try to|see if|as soon as|in case|otherwise)\b/;

export function routeIntent(input: string): Routing {
  const utterance = normalize(input);
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
