import type { z } from 'zod';
import { clickElement } from '@/lib/actions/page/click-element';
import { navigate } from '@/lib/actions/page/navigate';
import { pressKey } from '@/lib/actions/page/press-key';
import { scrollTo } from '@/lib/actions/page/scroll-to';

/**
 * The shapes a quick command can take. Each rule is a fully anchored pattern plus a `build`
 * that fills the action's input from the captured slots — and may reject the match outright
 * when the shape fit but the slot did not ("open the settings menu" looks like navigation
 * until you try to read "settings menu" as a host).
 *
 * Patterns are anchored at both ends by design: a quick command is the *whole* utterance.
 * Anything with a tail ("scroll down and tell me what it says") matches nothing here and
 * goes to the agent, which is the right outcome — so there is no partial-match scoring.
 */
export interface Rule {
  id: string;
  /** Action name from the registry — the same one the agent would have called. */
  action: string;
  /** How certain this *shape* is, before the slot is judged. See `confidence` on Built. */
  certainty: number;
  pattern: RegExp;
  build(groups: Record<string, string | undefined>): Built | null;
}

export interface Built {
  input: unknown;
  /** One line for the timeline, e.g. "Go back" or "Click Sign in". */
  label: string;
  /**
   * How well the captured slot fits, 0–1. Multiplied into the rule's certainty, this is what
   * separates "click Sign in" from "click it" — the same shape, very different odds.
   */
  confidence: number;
  /** Consequential enough that the agent's approval gate should see it instead. */
  risky?: boolean;
}

type NavigateInput = z.input<typeof navigate.input>;
type ScrollInput = z.input<typeof scrollTo.input>;
type ClickInput = z.input<typeof clickElement.input>;
type PressKeyInput = z.input<typeof pressKey.input>;

/**
 * Bare names people say instead of hostnames. A convenience list, not a redirect table: an
 * unlisted name simply fails to resolve and the utterance escalates.
 */
const SITES: Record<string, string> = {
  google: 'google.com',
  'google maps': 'maps.google.com',
  maps: 'maps.google.com',
  'google drive': 'drive.google.com',
  drive: 'drive.google.com',
  'google calendar': 'calendar.google.com',
  calendar: 'calendar.google.com',
  gmail: 'mail.google.com',
  youtube: 'youtube.com',
  github: 'github.com',
  reddit: 'reddit.com',
  wikipedia: 'wikipedia.org',
  twitter: 'twitter.com',
  linkedin: 'linkedin.com',
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  amazon: 'amazon.com',
  netflix: 'netflix.com',
  'stack overflow': 'stackoverflow.com',
  stackoverflow: 'stackoverflow.com',
  'hacker news': 'news.ycombinator.com',
  chatgpt: 'chatgpt.com',
  claude: 'claude.ai',
};

/** Spoken key names → `KeyboardEvent.key` values. */
const KEYS: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  space: ' ',
  spacebar: ' ',
  backspace: 'Backspace',
  delete: 'Delete',
  'page up': 'PageUp',
  'page down': 'PageDown',
  home: 'Home',
  end: 'End',
  'up arrow': 'ArrowUp',
  'down arrow': 'ArrowDown',
  'left arrow': 'ArrowLeft',
  'right arrow': 'ArrowRight',
  'arrow up': 'ArrowUp',
  'arrow down': 'ArrowDown',
  'arrow left': 'ArrowLeft',
  'arrow right': 'ArrowRight',
};

const KEY_NAMES = Object.keys(KEYS).join('|');

/**
 * Labels worth a human's blessing before the click lands. These escalate rather than run
 * locally — not because the agent is safer at clicking, but because an agent run puts the
 * call through the approval gate and onto the timeline, and a local one does neither.
 */
const CONSEQUENTIAL =
  /\b(?:buy|buy now|purchase|pay|payment|checkout|place order|order now|delete|remove|send|submit|transfer|withdraw|deposit|unsubscribe|subscribe|donate|book now|confirm)\b/;

/** Words that name an element only in context; the agent has the context, we do not. */
const DEICTIC = /^(?:it|that|this|there|them|those|these|him|her|thing|one)$/;

/** Beyond this the "label" is prose, not the name of a control. */
const MAX_LABEL_TOKENS = 8;

export const RULES: readonly Rule[] = [
  {
    id: 'history.back',
    action: navigate.name,
    certainty: 0.97,
    pattern: /^(?:go\s+)?back(?:\s+(?:a|one)\s+page)?$/,
    build: () => nav({ action: 'back' }, 'Go back'),
  },
  {
    id: 'history.forward',
    action: navigate.name,
    certainty: 0.97,
    pattern: /^(?:go\s+)?forwards?(?:\s+(?:a|one)\s+page)?$/,
    build: () => nav({ action: 'forward' }, 'Go forward'),
  },
  {
    id: 'history.reload',
    action: navigate.name,
    certainty: 0.97,
    pattern: /^(?:reload|refresh)(?:\s+(?:the|this)\s+page)?$/,
    build: () => nav({ action: 'reload' }, 'Reload the page'),
  },
  {
    // Two tokens at most, so "open the settings menu" cannot be read as a hostname.
    id: 'navigate.url',
    action: navigate.name,
    certainty: 0.95,
    pattern:
      /^(?:go\s+to|goto|open|visit|navigate\s+to|take\s+me\s+to|load|pull\s+up)\s+(?:the\s+)?(?<dest>\S+(?:\s+\S+)?)$/,
    build: ({ dest }) => {
      const site = SITES[dest!];
      if (site) return nav({ url: `https://${site}` }, `Open ${site}`, 1);
      const url = toUrl(dest!);
      // A bare host is a shade less certain than a name we know or a full URL: "open zoom"
      // is a hostname and an app name at once.
      return url ? nav({ url }, `Open ${dest}`, /^https?:\/\//.test(dest!) ? 1 : 0.97) : null;
    },
  },
  {
    id: 'navigate.search',
    action: navigate.name,
    certainty: 0.9,
    pattern: /^(?<verb>google|search\s+(?:the\s+web|google)\s+for|web\s+search\s+for)\s+(?<q>.+)$/,
    build: ({ verb, q }) => {
      const query = q!.trim();
      // "google maps" is a place to go, not a thing to search for; one word after a bare
      // "google" is too likely to be a destination, so let the agent decide.
      if (verb === 'google' && query.split(' ').length < 2) return null;
      return nav(
        { url: `https://www.google.com/search?q=${encodeURIComponent(query)}` },
        `Search the web for "${query}"`,
        verb === 'google' ? 0.95 : 1,
      );
    },
  },
  {
    id: 'scroll.direction',
    action: scrollTo.name,
    certainty: 0.95,
    pattern:
      /^(?:scroll|jump|move|go)(?:\s+(?:to|down\s+to|back\s+to|all\s+the\s+way\s+to))?\s+(?:the\s+)?(?<dir>up|down|top|bottom)(?:\s+of\s+(?:the\s+)?page)?$/,
    build: ({ dir }) => scroll({ direction: dir as ScrollDirection }, `Scroll ${dir}`),
  },
  {
    id: 'scroll.page',
    action: scrollTo.name,
    certainty: 0.95,
    pattern: /^page\s+(?<dir>up|down)$/,
    build: ({ dir }) => scroll({ direction: dir as ScrollDirection }, `Scroll ${dir}`),
  },
  {
    id: 'scroll.element',
    action: scrollTo.name,
    certainty: 0.85,
    pattern: /^scroll\s+(?:down\s+)?to\s+(?:the\s+)?(?<label>.+)$/,
    build: ({ label }) => {
      const text = slot(label!);
      return text && scroll({ target: { text: text.value } }, `Scroll to ${text.value}`, text.confidence);
    },
  },
  {
    id: 'key.press',
    action: pressKey.name,
    certainty: 0.97,
    pattern: new RegExp(`^(?:press|hit|tap|push)(?:\\s+the)?\\s+(?<key>${KEY_NAMES})(?:\\s+key)?$`),
    build: ({ key }) => {
      const dom = KEYS[key!];
      return dom ? built({ key: dom } satisfies PressKeyInput, `Press ${key}`) : null;
    },
  },
  {
    id: 'click.text',
    action: clickElement.name,
    certainty: 0.9,
    pattern: /^(?:click|tap|press|hit|push)(?:\s+on)?(?:\s+the)?\s+(?<label>.+?)(?:\s+(?<role>button|link|tab|checkbox))?$/,
    build: ({ label, role }) => {
      const text = slot(label!);
      if (!text) return null;
      const target = role ? { text: text.value, role } : { text: text.value };
      return {
        input: { target } satisfies ClickInput,
        label: `Click ${text.value}`,
        confidence: text.confidence,
        risky: CONSEQUENTIAL.test(text.value),
      };
    },
  },
];

type ScrollDirection = NonNullable<ScrollInput['direction']>;

const built = (input: unknown, label: string, confidence = 1): Built => ({ input, label, confidence });

const nav = (input: NavigateInput, label: string, confidence = 1): Built => built(input, label, confidence);

const scroll = (input: ScrollInput, label: string, confidence = 1): Built => built(input, label, confidence);

/**
 * Read a captured phrase as the name of a thing on the page, and say how much to trust it.
 * Null means it is not a name at all — prose, or nothing.
 */
function slot(raw: string): { value: string; confidence: number } | null {
  const value = raw.trim();
  if (!value) return null;
  const tokens = value.split(/\s+/);
  if (tokens.length > MAX_LABEL_TOKENS) return null;

  // "it" and friends name something only the conversation knows about.
  if (DEICTIC.test(value)) return { value, confidence: 0.55 };

  let confidence = 1;
  // A control's name is short. The longer the phrase, the more likely it describes a
  // position or a condition ("the blue one at the bottom") that needs the page to resolve.
  if (tokens.length > 4) confidence -= 0.12 * (tokens.length - 4);
  if (value.length < 2) confidence -= 0.4;
  return { value, confidence: Math.max(0, confidence) };
}

/** Read a destination slot as an http(s) URL, or null if it is not one. */
function toUrl(dest: string): string | null {
  if (/^https?:\/\/\S+$/.test(dest)) return dest;
  if (/^localhost(?::\d+)?(?:\/\S*)?$/.test(dest)) return `http://${dest}`;
  if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?$/.test(dest)) return `https://${dest}`;
  return null;
}
