/**
 * The declared guardrail policy.
 *
 * Rules are data. Each one names a condition from a closed vocabulary and an effect,
 * so the whole policy can be printed, diffed, and overridden from config without
 * touching enforcement code. `decide()` in ./decide.ts is the only thing that reads it.
 *
 * The policy exists because the daemon closes a loop that is normally kept open:
 * untrusted text comes in from a page, the browser holds live logged-in sessions, and
 * the agent can navigate anywhere. No prompt makes an agent immune to injection. What
 * a policy can do is make sure a successful injection has nowhere to send what it took
 * and cannot act outside the tab the user pointed at.
 *
 * Overriding, in `~/.browsentic/config.json`:
 *
 *   {
 *     "requireApproval": ["page.submitForm"],
 *     "guardrails": {
 *       "rules": { "off-scope-navigation": "deny", "raw-html-read": "allow" },
 *       "unattended": "allow",
 *       "hosts": ["example.com"]
 *     }
 *   }
 */

import { RESERVED_PREFIX } from '@/lib/actions/reserved';
import { hostAllowed, targetUrl, targetsAnotherTab, urlPayloadBytes, type Scope } from './scope';

export const SUBMIT_ACTION = 'page.submitForm';
export const UPLOAD_ACTION = 'page.attachFile';
export const EXTRACT_ACTION = 'page.extractText';
export const CAPTCHA_ACTION = 'page.solveCaptcha';

export type Effect = 'allow' | 'confirm' | 'deny';

/**
 * Who is asking. `agent` is a Browsentic run driven from the side panel — it has a
 * human watching and an approval channel. `external` is any MCP client attached to the
 * daemon; it has neither, so `confirm` cannot be answered and resolves via
 * `policy.unattended`.
 */
export type Caller = 'agent' | 'external';

export interface GuardrailRequest {
  readonly action: string;
  readonly input: unknown;
  readonly caller: Caller;
  readonly scope: Scope;
}

export type Condition = (request: GuardrailRequest, policy: Policy) => boolean;

/**
 * Every predicate a rule may name. Closed on purpose: a rule cannot express anything
 * that is not in here, which keeps the policy inspectable rather than arbitrary code.
 */
export const CONDITIONS = {
  /** Internal actions that only the daemon may originate. */
  reservedAction: (request) => request.action.startsWith(RESERVED_PREFIX),

  /** javascript:, data:, file: and friends dressed up as a navigation. */
  nonHttpNavigation: (request) => {
    const url = targetUrl(request.action, request.input);
    return !!url && url.protocol !== 'http:' && url.protocol !== 'https:';
  },

  /** Leaving the hosts the run was scoped to — the exfiltration path that matters most. */
  navigatesOffScope: (request) => {
    const url = targetUrl(request.action, request.input);
    return !!url && !hostAllowed(url.hostname, request.scope.hosts);
  },

  /** A navigation whose query string or fragment is large enough to be a payload. */
  carriesUrlPayload: (request, policy) => {
    const url = targetUrl(request.action, request.input);
    return !!url && urlPayloadBytes(url) > policy.urlPayloadBytes;
  },

  /** Anything that commits a form, however it is spelled. */
  submitsForm: (request) => submitsForm(request.action, request.input),

  /** Putting one of the user's files into a page. */
  uploadsFile: (request) => request.action === UPLOAD_ACTION,

  /** Moving to a tab the run was not pointed at — someone else's logged-in session. */
  leavesPinnedTab: (request) => targetsAnotherTab(request.action, request.input, request.scope),

  /** Acting on another site's human-verification control. */
  answersCaptcha: (request) => request.action === CAPTCHA_ACTION,

  /** Raw outerHTML: comments, aria-hidden nodes and off-screen text, the classic carrier. */
  readsRawHtml: (request) =>
    request.action === EXTRACT_ACTION && (request.input as { format?: unknown } | undefined)?.format === 'html',

  /**
   * Named by the user in the legacy `requireApproval` config key. Submits are excluded
   * because `form-submission` already owns them — its effect is derived from this same
   * key, and matching twice would say it twice in the prompt.
   */
  listedInConfig: (request, policy) =>
    request.action !== SUBMIT_ACTION && policy.requireApproval.includes(request.action),
} satisfies Record<string, Condition>;

export type ConditionName = keyof typeof CONDITIONS;

export interface Rule {
  /** Stable id. Used to override the effect from config and to name it in logs. */
  readonly id: string;
  readonly when: ConditionName;
  readonly effect: Effect;
  /** One line, for the approval prompt and the daemon log. */
  readonly title: string;
  /** What the agent is told when this rule blocks or is declined. */
  readonly reason: string;
}

export const DEFAULT_RULES: readonly Rule[] = [
  {
    id: 'reserved-action',
    when: 'reservedAction',
    effect: 'deny',
    title: 'Reserved action',
    reason: 'That action is internal to Browsentic and cannot be called.',
  },
  {
    id: 'non-http-navigation',
    when: 'nonHttpNavigation',
    effect: 'deny',
    title: 'Non-http navigation',
    reason: 'Only http(s) URLs can be opened.',
  },
  {
    id: 'off-scope-navigation',
    when: 'navigatesOffScope',
    effect: 'confirm',
    title: 'Leaves the sites this run is about',
    reason: 'That URL is not on a site this run was asked about.',
  },
  {
    id: 'url-payload',
    when: 'carriesUrlPayload',
    effect: 'confirm',
    title: 'Carries a large payload in the URL',
    reason: 'That URL carries an unusually large query string, which is how page content gets smuggled out.',
  },
  {
    id: 'form-submission',
    when: 'submitsForm',
    effect: 'confirm',
    title: 'Submits a form',
    reason: 'Submitting a form is a consequential action.',
  },
  {
    id: 'file-upload',
    when: 'uploadsFile',
    effect: 'confirm',
    title: 'Uploads one of the user’s files',
    reason: 'Putting a file into a page hands it to whoever runs that site.',
  },
  {
    id: 'leaves-pinned-tab',
    when: 'leavesPinnedTab',
    effect: 'confirm',
    title: 'Moves to another tab',
    reason: 'That tab is not the one this run was pointed at, and may hold a different logged-in session.',
  },
  {
    // A captcha is another site's check that a person is present. Ticking its checkbox is
    // something the user can authorise for their own browsing, but never something to do
    // on their behalf unasked — so it confirms for a watched run, and `unattended: deny`
    // keeps an external MCP client from doing it silently.
    id: 'captcha-solve',
    when: 'answersCaptcha',
    effect: 'confirm',
    title: 'Answers a captcha',
    reason: 'That ticks a site’s “I am a human” check on your behalf.',
  },
  {
    id: 'config-require-approval',
    when: 'listedInConfig',
    effect: 'confirm',
    title: 'Listed in requireApproval',
    reason: 'The user asked to approve this action every time.',
  },
  {
    // outerHTML carries comments, aria-hidden nodes and off-screen text: everything a
    // page can hide from the person looking at it but still hand to the model. Denied by
    // default because page.extractText's rendered text is what a reader actually sees,
    // and innerText has already dropped the hidden nodes. Set this to "allow" if a run
    // genuinely needs markup.
    id: 'raw-html-read',
    when: 'readsRawHtml',
    effect: 'deny',
    title: 'Reads raw HTML',
    reason: 'Reading raw HTML is disabled by policy. Use the default text format instead.',
  },
];

export interface FencePolicy {
  readonly enabled: boolean;
  /** Actions whose results carry no page-authored text, or that are fenced elsewhere. */
  readonly except: readonly string[];
}

export interface Policy {
  readonly rules: readonly Rule[];
  /** Legacy config key, still honoured: actions to confirm every time. */
  readonly requireApproval: readonly string[];
  /** What `confirm` becomes for a caller with no way to ask. */
  readonly unattended: 'allow' | 'deny';
  readonly urlPayloadBytes: number;
  readonly fence: FencePolicy;
}

export interface GuardrailConfig {
  /** Override any rule's effect by id. */
  rules?: Record<string, Effect>;
  unattended?: 'allow' | 'deny';
  urlPayloadBytes?: number;
  /** Standing host allowlist added to every run's scope. `['*']` disables confinement. */
  hosts?: string[];
  fence?: boolean;
}

const DEFAULT_URL_PAYLOAD_BYTES = 512;

const DEFAULT_FENCE: FencePolicy = {
  enabled: true,
  // closeTab and stopMonitor return an acknowledgement; screenshots are fenced by the
  // image-specific renderer instead.
  except: ['page.closeTab', 'page.stopMonitor', 'page.screenshot'],
};

/**
 * Build a policy from config. `unattended` is `deny`: an external MCP client has no
 * approval channel, and leaning on its host to prompt stops being true the moment
 * someone allowlists the browsentic tools to stop being asked. A caller with nobody
 * watching does not get the consequential actions. Set it to `allow` to go back to
 * waiving them, and read `decide()` for what that waives.
 */
export function policyFrom(config: GuardrailConfig = {}, requireApproval: readonly string[] = [SUBMIT_ACTION]): Policy {
  const overrides = config.rules ?? {};
  const rules = DEFAULT_RULES.map((rule) => {
    // The legacy key owns the form gate, so `requireApproval: []` still means "gate nothing".
    const legacy = rule.id === 'form-submission' && !requireApproval.includes(SUBMIT_ACTION) ? 'allow' : rule.effect;
    return { ...rule, effect: overrides[rule.id] ?? legacy };
  });

  return {
    rules,
    requireApproval,
    unattended: config.unattended === 'allow' ? 'allow' : 'deny',
    urlPayloadBytes:
      typeof config.urlPayloadBytes === 'number' && config.urlPayloadBytes >= 0
        ? config.urlPayloadBytes
        : DEFAULT_URL_PAYLOAD_BYTES,
    fence: config.fence === false ? { ...DEFAULT_FENCE, enabled: false } : DEFAULT_FENCE,
  };
}

/** The policy with nothing configured. */
export const POLICY: Policy = policyFrom();

/**
 * Whether an action commits a form, however it is spelled. Lives here rather than with
 * the action definitions because it is a policy judgement, not a fact about the action.
 */
export function submitsForm(action: string, input: unknown): boolean {
  if (action === SUBMIT_ACTION) return true;
  const args = (input ?? {}) as { pressEnter?: unknown; key?: unknown };
  if (action === 'page.fillInput' || action === 'page.typeText') return args.pressEnter === true;
  if (action === 'page.pressKey') return args.key === 'Enter';
  return false;
}
