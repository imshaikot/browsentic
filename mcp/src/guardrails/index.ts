/**
 * Guardrails: what the agent is allowed to do, how page text reaches it, and what the
 * process running it may touch.
 *
 * Three halves, all declarative:
 *
 *   policy.ts   what may happen in a page — rules as data over a closed set of conditions
 *   fence.ts    what the model is told about where text came from
 *   spawn.ts    what the agent CLI itself is allowed to reach on the machine
 *
 * and pure helpers that read them: `decide()`, `fence()`, `vetPlan()`, `sealEnv()`.
 * Enforcement lives at the daemon's choke points — `invokeExternal` and
 * `AgentSession.invokeForRun` for the decision, `createMcpServer`'s renderers for the
 * fence, `launch()` for the spawn — so every caller is covered.
 */

export { ANYWHERE, hostAllowed, normalizeHost, scopeFor, targetUrl, targetsAnotherTab, urlPayloadBytes } from './scope';
export type { Scope, ScopeSeed } from './scope';

export {
  CONDITIONS,
  DEFAULT_RULES,
  EXTRACT_ACTION,
  POLICY,
  SUBMIT_ACTION,
  UPLOAD_ACTION,
  policyFrom,
  submitsForm,
} from './policy';
export type { Caller, Condition, ConditionName, Effect, FencePolicy, GuardrailConfig, GuardrailRequest, Policy, Rule } from './policy';

export { DECLINED_MESSAGE, blocked, decide, declined, describe, summary } from './decide';
export type { Decision } from './decide';

export { FENCE_NOTE, IMAGE_NOTE, fence, fenceTag, shouldFence } from './fence';

export { CONTAINMENT, describeContainment, sealEnv, sealedAway, vetPlan } from './spawn';
export type { LocalTools, SpawnMode, SpawnPlan } from './spawn';
