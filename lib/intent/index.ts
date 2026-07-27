/**
 * The local intent funnel: a small deterministic grammar that answers "can the extension do
 * this itself, right now?" before an instruction is sent to the daemon and the agent.
 *
 * It is pure — no DOM, no `browser.*`, no network — so it can be exercised from plain Node
 * (`npm run intent:check`) against the fixture table, which is where the threshold is tuned.
 */
export { normalize, type Utterance } from './normalize';
export { RULES, type Rule, type Built } from './grammar';
export {
  ACT_THRESHOLD,
  routeIntent,
  type EscalationReason,
  type LocalIntent,
  type Routing,
} from './route';
