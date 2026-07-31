import type { z } from 'zod';
import { clickElement } from '@/lib/actions/page/click-element';
import { navigate } from '@/lib/actions/page/navigate';
import { pressKey } from '@/lib/actions/page/press-key';
import { scrollTo } from '@/lib/actions/page/scroll-to';
import { START_RECORDING_ACTION, STOP_RECORDING_ACTION } from '@/lib/recordings/events';

export interface Rule {
  id: string;
  action: string;
  certainty: number;
  pattern: RegExp;
  build(groups: Record<string, string | undefined>): Built | null;
}

export interface Built {
  input: unknown;
  label: string;
  confidence: number;
  risky?: boolean;
}

type NavigateInput = z.input<typeof navigate.input>;
type ScrollInput = z.input<typeof scrollTo.input>;
type ClickInput = z.input<typeof clickElement.input>;
type PressKeyInput = z.input<typeof pressKey.input>;

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

const SUBMITTING_KEYS = new Set(['enter', 'return']);

const KEYS: Record<string, string> = {
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

const CONSEQUENTIAL =
  /\b(?:buy|buy now|purchase|pay|payment|checkout|place order|order now|delete|remove|send|submit|transfer|withdraw|deposit|unsubscribe|subscribe|donate|book now|confirm)\b/;

const DEICTIC = /^(?:it|that|this|there|them|those|these|him|her|thing|one)$/;

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
    id: 'navigate.url',
    action: navigate.name,
    certainty: 0.95,
    pattern:
      /^(?:go\s+to|goto|open|visit|navigate\s+to|take\s+me\s+to|load|pull\s+up)\s+(?:the\s+)?(?<dest>\S+(?:\s+\S+)?)$/,
    build: ({ dest }) => {
      const site = SITES[dest!];
      if (site) return nav({ url: `https://${site}` }, `Open ${site}`, 1);
      const url = toUrl(dest!);
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
    id: 'recording.start',
    action: START_RECORDING_ACTION,
    certainty: 0.95,
    pattern:
      /^(?:start\s+record(?:ing)?(?:\s+(?:my|this|the))?(?:\s+(?:browsing|browser))?(?:\s+session)?|record(?:ing)?(?:\s+(?:my|this|the))?(?:\s+(?:browsing|browser))?\s+session)$/,
    build: () => built({ captureValues: false }, 'Start recording this session'),
  },
  {
    id: 'recording.stop',
    action: STOP_RECORDING_ACTION,
    certainty: 0.95,
    pattern: /^(?:stop|end|finish)\s+(?:the\s+)?recording$/,
    build: () => built({}, 'Stop recording'),
  },
  {
    id: 'click.text',
    action: clickElement.name,
    certainty: 0.9,
    pattern: /^(?:click|tap|press|hit|push)(?:\s+on)?(?:\s+the)?\s+(?<label>.+?)(?:\s+(?<role>button|link|tab|checkbox))?$/,
    build: ({ label, role }) => {
      const text = slot(label!);
      if (!text) return null;
      if (!role && SUBMITTING_KEYS.has(text.value.toLowerCase())) return null;
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

function slot(raw: string): { value: string; confidence: number } | null {
  const value = raw.trim();
  if (!value) return null;
  const tokens = value.split(/\s+/);
  if (tokens.length > MAX_LABEL_TOKENS) return null;

  if (DEICTIC.test(value)) return { value, confidence: 0.55 };

  let confidence = 1;
  if (tokens.length > 4) confidence -= 0.12 * (tokens.length - 4);
  if (value.length < 2) confidence -= 0.4;
  return { value, confidence: Math.max(0, confidence) };
}

function toUrl(dest: string): string | null {
  if (/^https?:\/\/\S+$/.test(dest)) return dest;
  if (/^localhost(?::\d+)?(?:\/\S*)?$/.test(dest)) return `http://${dest}`;
  if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?$/.test(dest)) return `https://${dest}`;
  return null;
}
