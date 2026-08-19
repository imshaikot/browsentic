// Sourced from the repository README and docs/. Components hold no copy of their own.

export const REPO = 'https://github.com/imshaikot/browsentic'
export const VERSION = 'v0.1.7'

export const STATS = [
  { value: 28, suffix: '', label: 'page capabilities', note: 'read, act, move, monitor' },
  { value: 3, suffix: '', label: 'read-only resources', note: 'page context, zero tool calls' },
  { value: 0, suffix: '', label: 'API keys to configure', note: 'runs on your Claude Code login' },
  { value: 10, suffix: ' min', label: 'pairing code lifetime', note: 'single use, then a session key' },
] as const

export type ToolGroup = {
  id: string
  label: string
  blurb: string
  accent: 'brand' | 'ember' | 'magenta' | 'lime' | 'amber' | 'brand-deep'
  tools: string[]
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'read',
    label: 'Read',
    accent: 'brand',
    blurb:
      'A structured snapshot with a layout diagram and stable selectors, rendered text or raw HTML, waits for an element to appear or vanish, and screenshots of the tab or a single element.',
    tools: [
      'page_getPageInfo',
      'page_extractText',
      'page_waitForElement',
      'page_findProgress',
      'page_screenshot',
    ],
  },
  {
    id: 'act',
    label: 'Act',
    accent: 'ember',
    blurb:
      'Click, hover, focus, fill inputs and contenteditables, stream text in keystroke by keystroke at a human pace, choose a select option, select text, press keys with modifiers, submit a form.',
    tools: [
      'page_clickElement',
      'page_hoverElement',
      'page_focusInput',
      'page_fillInput',
      'page_typeText',
      'page_selectOption',
      'page_selectText',
      'page_pressKey',
      'page_submitForm',
      'page_highlightElement',
    ],
  },
  {
    id: 'move',
    label: 'Move',
    accent: 'magenta',
    blurb:
      'Open a URL, go back and forward, reload, scroll to an element or a position, open a URL in a new tab, list and switch between open tabs, close one.',
    tools: ['page_navigate', 'page_scrollTo', 'page_openTab', 'page_switchTab', 'page_closeTab'],
  },
  {
    id: 'monitor',
    label: 'Monitor',
    accent: 'lime',
    blurb:
      'Find the progress signals on a page, then watch one tab in the background until an upload, build or deploy finishes. The tab is pinned, percent and ETA are tracked, and an MCP client can long-poll for completion.',
    tools: ['page_startMonitor', 'page_monitorStatus', 'page_awaitMonitor', 'page_stopMonitor'],
  },
  {
    id: 'files',
    label: 'Files',
    accent: 'amber',
    blurb:
      'List the files stored in Browsentic and attach one to a file input on the page, so an upload flow does not need a human at the file picker.',
    tools: ['page_listFiles', 'page_attachFile'],
  },
  {
    id: 'recordings',
    label: 'Recordings',
    accent: 'brand-deep',
    blurb:
      'List the browsing sessions you recorded, and read one back as ordered, replayable steps that the agent re-checks against the live page before acting.',
    tools: ['page_listRecordings', 'page_readRecording'],
  },
]

export const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools)

export const RESOURCES = [
  { uri: 'browsentic://page/diagram', desc: 'Layout diagram with stable selectors' },
  { uri: 'browsentic://page/current', desc: 'Structured snapshot of the active tab' },
  { uri: 'browsentic://page/text', desc: 'Rendered text, as a reader would see it' },
]

export const PIPELINE = [
  {
    id: 'you',
    title: 'You',
    sub: 'Speak, type, or show it once',
    body: 'Hands-free dictation in the side panel, press-to-talk in the popup, or plain typing. Do a repetitive job yourself once and it keeps the steps.',
  },
  {
    id: 'extension',
    title: 'Extension',
    sub: 'Manifest V3, Chrome & Firefox',
    body: 'Scores your instruction against a local grammar first. Confident one-step commands run right here in milliseconds. Everything else is passed on untouched.',
  },
  {
    id: 'daemon',
    title: 'Daemon',
    sub: 'Local WebSocket, loopback only',
    body: 'The extension dials out, because an MV3 service worker cannot listen. One daemon owns the browser link, so several MCP clients can share one browser.',
  },
  {
    id: 'agent',
    title: 'Your Claude Code',
    sub: 'Your login, your machine',
    body: 'Spawned locally against the login you already have. No Anthropic API client in the repository, no key to configure, no third-party relay.',
  },
]

export const MODES = [
  {
    id: 'site-maps',
    tab: 'Site maps',
    kicker: 'Teach it a site once',
    title: 'It explores your site, then writes down what it learned',
    body: 'An agent that has never seen your site spends its first minutes rediscovering it: where search lives, what a button is really called, why the list looks empty until you scroll. Browsentic reads the site’s own robots.txt and sitemap.xml, looks up public background on the domain, then walks it for a few minutes taking screenshots. From then on, any instruction on that domain carries those notes. Elsewhere they are inert.',
    invocation: '@site-mapper map this site',
    points: [
      ['Nothing takes effect until you say so', 'A map in flight is written to a staging directory the skill loader cannot read — an unreviewed map is not merely unused, it is never opened.'],
      ['You read the exact markdown', 'The panel shows it as plain text, never rendered, alongside the domain it will match. Activate arms it, Discard deletes it.'],
      ['Read-only and locked to one host', 'It cannot click, fill or submit, cannot leave the site, and is pinned to the tab it started in — switching tabs stops it rather than following you.'],
      ['Ceilings the config can narrow but never widen', '15 pages, 10 screenshots and 10 minutes by default; 40, 24 and 30 minutes are the hard limits enforced by the daemon.'],
    ],
    tree: [
      ['~/browsentic/skills/acme-com/', ''],
      ['├── SKILL.md', 'landmarks, key pages, quirks'],
      ['├── map.json', 'the structured report behind it'],
      ['├── screenshots/', 'captures taken during the crawl'],
      ['├── evidence/', 'the robots.txt and sitemap it worked from'],
      ['└── pages/', 'per-page notes, kept out of the prompt'],
    ],
  },
  {
    id: 'recordings',
    tab: 'Recordings',
    kicker: 'Show it once, repeat it later',
    title: 'A site map teaches it what a site is. A recording teaches it what you do there',
    body: 'Press record in the composer, then do the job yourself — click through the pages, fill the fields, submit the form — and press stop. Browsentic splits what you did into ordered steps, names them after what you accomplished, and keeps them in a list you can rename. Later, “do it like last time” runs them again.',
    invocation: 'record my browsing session',
    points: [
      ['What you type is not saved by default', 'Every field you fill becomes a placeholder — {{email}}, {{invoice_number}} — and the assistant asks you for the value when it replays.'],
      ['Some things are never stored either way', 'Passwords, hidden fields, one-time codes and anything shaped like a card number are dropped whether or not you opt in to literal values.'],
      ['Replaying is not blind playback', 'The steps are a plan, not a script. The agent re-checks each target against the live page and prefers the visible text it recorded over the CSS selector, because selectors are what a redesign breaks first.'],
      ['It stops rather than improvising', 'If a step no longer lands, the run halts and tells you which one, instead of finding a different route to the same effect.'],
    ],
    tree: [
      ['Recording · 15 min ceiling', 'warns at 13, stops itself at the limit'],
      ['✓ Step 1', 'Open the invoices list'],
      ['✓ Step 2', 'Filter to unpaid'],
      ['✓ Step 3', 'Fill {{invoice_number}}'],
      ['● Step 4', 'Submit — waits for your approval'],
    ],
  },
  {
    id: 'instant',
    tab: 'Instant commands',
    kicker: 'Not everything needs a model',
    title: 'Sending “go back” to a language model costs a round trip to arrive somewhere the browser already was',
    body: 'So every instruction is scored against a local grammar first. Confident single-step commands run in the browser and stop there, marked with a bolt on the timeline. Everything else goes to the agent with the text untouched. The bias is deliberately toward escalating, because the two mistakes are not symmetric: escalating something it could have handled costs a round trip, while acting on something it misread spends a wrong click on your real page.',
    invocation: 'yarn intent:check "take me to the checkout page"',
    points: [
      ['Runs locally, in milliseconds', 'back, forward, reload · open github.com · scroll to the top · press enter · click Sign in · google something · stop recording'],
      ['Goes to the agent', '“is there a login button?” · “open the settings menu” · “click Buy now” · “scroll down and tell me what it says” · “click it”'],
      ['Questions always escalate', 'So do multi-step asks, conditionals, vague targets and consequential clicks — as does any local command that runs and fails.'],
      ['You can audit a single decision', 'Route one utterance through the grammar from the command line and see exactly why it went where it went.'],
    ],
    tree: [
      ['⚡ go back', 'local · 4ms'],
      ['⚡ scroll to the top', 'local · 2ms'],
      ['→ is there a login button?', 'agent'],
      ['⚡ open github.com', 'local · 6ms'],
      ['→ click Buy now', 'agent · consequential'],
    ],
  },
] as const

export const SECURITY = [
  {
    title: 'Off by default',
    body: 'A fresh install connects to nothing. An unpaired extension never contacts the daemon at all, and pairing takes a single-use code you redeem yourself.',
  },
  {
    title: 'Two independent gates',
    body: 'Any web page can open a WebSocket to loopback, so the daemon first classifies the peer by handshake Origin — which browsers set themselves and pages cannot forge — then requires a pairing token or a session key bound to that same origin. A web page can never reach the control path.',
  },
  {
    title: 'Consequential actions ask first',
    body: 'Approval prompts appear in the side panel with the action named. Form submission is gated by default, because it is the one effect that reaches someone other than you. Cancelling a run stops it mid-flight.',
  },
  {
    title: 'Recordings capture what you do, not what you type',
    body: 'A recording stores the identity of each field and a placeholder for its value. Keeping literal values is per-recording and off by default. Recording only ever starts from your own click or your own words.',
  },
  {
    title: 'Speech uses the browser’s own recognition',
    body: 'No model is bundled and nothing is downloaded. Chrome’s Web Speech API streams audio to Google to transcribe it, and replacing the speech engine is a one-file change.',
  },
  {
    title: 'State stays outside the repository',
    body: 'Pairing keys, logs, config, skills and screenshots live under ~/.browsentic and ~/browsentic — never in your checkout, never in a commit.',
  },
]

export const LIMITS = [
  {
    title: 'Pairing controls which browser, not which process',
    body: 'Anything running as your user can read the daemon lockfile and drive an already-paired browser.',
  },
  {
    title: 'A hostile page is still a hostile page',
    body: 'An agent reading one is susceptible to prompt injection. Treat page content as data, never as instructions.',
  },
]

export const QUICKSTART = [
  {
    n: '01',
    title: 'Clone and build both halves',
    body: 'The extension and the daemon are separate packages. One command installs and builds both — it needs nothing on your PATH but Node 20+, because the pinned Yarn release ships in the repository.',
    code: 'git clone https://github.com/imshaikot/browsentic.git\ncd browsentic\nnode scripts/setup.mjs',
    lang: 'sh',
  },
  {
    n: '02',
    title: 'Load the unpacked extension',
    body: 'Open chrome://extensions, enable Developer mode, choose Load unpacked and select the build output. Firefox builds work too.',
    code: 'dist/chrome-mv3',
    lang: 'path',
  },
  {
    n: '03',
    title: 'Put the daemon on your PATH and pair',
    body: 'The pairing code is single-use and lives for ten minutes. Paste it into the popup and press Connect — the daemon then issues a long-lived session key that survives browser and daemon restarts, and dies only when you revoke it.',
    code: 'yarn mcp:link        # global npm prefix, so it stays a separate step\nbrowsentic-mcp pair  # prints a single-use code, valid for 10 minutes',
    lang: 'sh',
  },
  {
    n: '04',
    title: 'Point any MCP client at the same browser',
    body: 'Claude Code now has 28 page tools plus browsentic_status, and three read-only resources that return page context without spending a tool call.',
    code: 'claude mcp add browsentic -- browsentic-mcp',
    lang: 'sh',
  },
]

export const FAQ = [
  {
    q: 'Do I need an Anthropic API key?',
    a: 'No. Browsentic runs on the Claude Code login you already have. There is no Anthropic API client anywhere in the repository and nothing to paste into a settings field — the daemon spawns Claude Code locally, as you.',
  },
  {
    q: 'Is this a headless browser?',
    a: 'The opposite. It drives the real, logged-in tab in front of you — your sessions, your cookies, your extensions, your two-factor state. Nothing has to be re-authenticated in a throwaway profile.',
  },
  {
    q: 'What stops a random web page from driving my browser?',
    a: 'Two gates. The daemon classifies every WebSocket peer by its handshake Origin, which the browser sets and a page cannot forge, and then still requires a pairing token or an origin-bound session key. A page fails the first gate and never reaches the second.',
  },
  {
    q: 'Can I use it from something other than Claude Code?',
    a: 'Yes. The daemon speaks MCP over stdio, so any MCP client can drive the same browser: claude mcp add browsentic -- browsentic-mcp, or the equivalent in your client. Tool definitions are generated from the same registry the extension ships, so they cannot drift from what the browser can actually do.',
  },
  {
    q: 'Which browsers work?',
    a: 'Chrome or any Chromium browser via Manifest V3, and Firefox builds work too. You will need Node.js 20 or newer, and Claude Code on your PATH.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. It is MIT licensed and open source. The only cost is whatever your existing Claude Code plan already costs you.',
  },
  {
    q: 'How do I add a capability?',
    a: 'One module in lib/actions/page/ and one line in the registry — which publishes it as an MCP tool at the same time. Four conventions in an action module are load-bearing at runtime: touch document and window only inside execute(), keep underscores out of action names, describe() every input field, and validate with ActionError inside execute() rather than a zod refine or transform.',
  },
]

export const NAV_LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#teach', label: 'Teach it' },
  { href: '#mcp', label: 'MCP' },
  { href: '#security', label: 'Security' },
  { href: '#start', label: 'Get started' },
]
