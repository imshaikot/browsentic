// Sourced from the repository README and docs/. Components hold no copy of their own.

export const REPO = 'https://github.com/imshaikot/browsentic'
export const VERSION = 'v0.2.1'

export const SEO = {
  title: 'Browsentic: give your browser real agency',
  description:
    'Browsentic hands your browser real agency. Perceiving the page, listening when you speak, sensing when a job lands, then reasoning, acting and automating inside your real, logged-in tab. It plugs into the AI you already run, with no API key.',
  social: {
    title: 'Browsentic: agentic browsing, in the browser you already use',
    description:
      'Scan, capture, behave, automate. 35 page tools, automatic site maps, recordings and instant commands, all inside the real logged-in browser you already use.',
  },
  imageAlt:
    'Browsentic. Your real browser, now agentic. 35 page tools, trusted input, MCP server, MIT licensed.',
  author: 'imshaikot',
  summary:
    'A browser extension plus a local daemon that lets any MCP client drive your real, logged-in browser tab by voice, by typing, or by replaying a session you recorded once.',
  keywords: [
    'browser automation',
    'MCP server',
    'Model Context Protocol',
    'agentic browsing',
    'browser extension',
    'Claude Code',
    'Chrome extension',
    'browser agent',
    'web automation',
    'site mapping',
  ],
} as const

export const HERO = {
  badge: 'MIT-licensed, and it thinks with the agent CLI you already run: Claude Code, Codex or Antigravity',
  title: { lead: 'Reimagine browsing', tail: 'as ', accent: 'agentic' },
  lede: 'Browsentic hands your browser real agency. Perceiving the page, listening when you speak, sensing the moment a job lands, then reasoning, acting and automating everything you would otherwise grind through by hand. All of it inside the tab you already trust: your sessions, your logins, your machine.',
  voice: 'or open the side panel and speak it aloud',
  command: 'claude mcp add browsentic -- browsentic-mcp',
} as const

export type SectionCopy = { kicker: string; title: string | readonly string[]; lede?: string }

export const SECTIONS = {
  how: {
    kicker: 'Architecture',
    title: ['Four hops, and every one of them', 'is on your machine'],
    lede: 'No relay, no hosted runner, no browser in someone else’s data centre. The extension dials out to a daemon on loopback, because a Manifest V3 service worker cannot listen for connections. One daemon owns the browser link, so several MCP clients can share one browser.',
  },
  capabilities: {
    kicker: 'Capabilities',
    title: ['Scan, capture, behave, automate.', 'Thirty-five ways to work a page'],
    lede: 'Perceiving the page as structure rather than pixels: a layout diagram, stable selectors, rendered text, screenshots. Listening while you talk it through. Sensing progress and waiting out an upload or a deploy so you never have to hover over it. Then acting with a human hand, and remembering enough to run the whole thing again unprompted. Aim by CSS selector, visible text, ARIA role or index, because visible text outlives the redesigns that break selectors.',
  },
  teach: {
    kicker: 'Skills',
    title: ['Map any web app automatically,', 'then keep it as your own skill'],
    lede: 'Turn it loose on a site and it maps itself. It reads robots.txt and the sitemap, explores, screenshots, writes down what it worked out, then hands you a skill to read before you arm it. Walk it through a job once and that becomes a skill of your own. And the obvious commands never bother a model at all.',
  },
  mcp: {
    kicker: 'MCP server',
    title: ['Plug it into the AI you already run,', 'and hand it a browser that is logged in'],
    lede: 'Claude Code, Codex, Antigravity, Cursor, Zed: anything fluent in MCP takes the wheel of the same real tab. Headless automation wakes up with amnesia, no session, no cookies, no two-factor state, and a login wall between it and anything worth doing. Browsentic inherits the tab you are already signed into.',
  },
  security: {
    kicker: 'Security model',
    title: 'An agent driving your real browser has to earn it',
    lede: 'Everything below is a property of how it is built, not a promise in a policy document. It is a local daemon, an extension that dials out to it, and no third party in between.',
  },
  start: {
    kicker: 'Quickstart',
    title: 'Four steps, about five minutes',
    lede: 'You need Chrome or another Chromium browser, Node.js 20 or newer, and one agent CLI on your PATH: claude, codex or agy. Yarn is pinned inside the repository, so whichever yarn you have re-executes into the right one. There is no global install or Corepack setup.',
  },
  faq: {
    kicker: 'FAQ',
    title: 'The ones people ask first',
  },
} as const satisfies Record<string, SectionCopy>

export const CTA = {
  title: { lead: 'Stop describing the page.', accent: 'Hand it over.' },
  lede: 'Free and MIT licensed. Nothing to sign up for, no key to paste, and a fresh install connects to nothing until you redeem a pairing code yourself.',
  command: 'git clone https://github.com/imshaikot/browsentic.git',
} as const

export const MCP_POINTS = [
  {
    id: 'clients',
    title: 'Any MCP client, one browser',
    body: 'The daemon speaks MCP over stdio, so Claude Code, Codex, Antigravity or anything else that speaks the protocol drives the same real, logged-in browser. Several at once, because one daemon owns the link.',
  },
  {
    id: 'manifest',
    title: 'The manifest cannot drift',
    body: 'Tool definitions are generated from the same registry the extension ships. A tool that describes something the browser cannot do is not a bug you can write. It is a build that does not exist.',
  },
  {
    id: 'extend',
    title: 'Create your own action in one file',
    body: 'A module under lib/actions/page/ plus one line in the registry, and it publishes as an MCP tool at the same time. No second place to remember.',
  },
] as const

export const STATS = [
  { value: 35, suffix: '', label: 'page tools', note: 'read, act, navigate, monitor' },
  { value: 3, suffix: '', label: 'read-only resources', note: 'page context, zero tool calls' },
  { value: 0, suffix: '', label: 'API keys to configure', note: 'it runs on the login you already own' },
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
      'Takes in the page as structure rather than pixels: a snapshot carrying a layout diagram and stable selectors, rendered text, patient waiting for an element to appear or vanish, a capture of the whole tab or one element, the palette and luminance a page actually paints, a WCAG contrast score, and the captcha hiding inside a closed shadow root.',
    tools: [
      'page_getPageInfo',
      'page_extractText',
      'page_waitForElement',
      'page_findProgress',
      'page_screenshot',
      'page_readTheme',
      'page_auditContrast',
      'page_findCaptcha',
    ],
  },
  {
    id: 'act',
    label: 'Act',
    accent: 'ember',
    blurb:
      'Reaches into the page with a human hand. Pointing, hovering, dragging, focusing, filling inputs and contenteditables, streaming text in keystroke by keystroke at a human pace, choosing an option, selecting a passage, pressing keys with modifiers, committing a form, clicking with a genuine browser-level gesture where a synthetic one is refused, ticking a captcha checkbox, and retheming a page on its own terms.',
    tools: [
      'page_clickElement',
      'page_trustedClick',
      'page_hoverElement',
      'page_dragElement',
      'page_focusInput',
      'page_fillInput',
      'page_typeText',
      'page_selectOption',
      'page_selectText',
      'page_pressKey',
      'page_submitForm',
      'page_solveCaptcha',
      'page_applyTheme',
      'page_highlightElement',
    ],
  },
  {
    id: 'move',
    label: 'Navigate',
    accent: 'magenta',
    blurb:
      'Finds its own way around. Opening a URL, retracing back and forward, reloading, scrolling to whatever matters, spawning a tab, surveying the ones you already have open, closing the ones it is finished with.',
    tools: ['page_navigate', 'page_scrollTo', 'page_openTab', 'page_switchTab', 'page_closeTab'],
  },
  {
    id: 'monitor',
    label: 'Monitor',
    accent: 'lime',
    blurb:
      'Senses the progress signals a page gives off, then keeps watch in the background while an upload, a build or a deploy runs its course. The tab stays pinned, percent and ETA are tracked, and an MCP client can long-poll until it lands.',
    tools: ['page_startMonitor', 'page_monitorStatus', 'page_awaitMonitor', 'page_stopMonitor'],
  },
  {
    id: 'files',
    label: 'Files',
    accent: 'amber',
    blurb:
      'Reaches for the files you keep in Browsentic and hands one to a file input on the page, so an upload flow stops waiting on a human at the file picker.',
    tools: ['page_listFiles', 'page_attachFile'],
  },
  {
    id: 'recordings',
    label: 'Recordings',
    accent: 'brand-deep',
    blurb:
      'Recalls the sessions you recorded and replays them as ordered, deliberate steps, re-checking every target against the live page before it commits to acting.',
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
    body: 'Dictate hands-free in the side panel, hold to talk in the popup, or just type. Work through a tedious job yourself once and it keeps every step.',
  },
  {
    id: 'extension',
    title: 'Extension',
    sub: 'Manifest V3, Chrome & Firefox',
    body: 'Weighs your instruction against a local grammar before anyone spends a token. Confident one-step commands fire right here, in milliseconds. Everything else travels on untouched.',
  },
  {
    id: 'daemon',
    title: 'Daemon',
    sub: 'Local WebSocket, loopback only',
    body: 'The extension dials out, because an MV3 service worker cannot listen. One daemon owns the browser link, so several MCP clients can share one browser.',
  },
  {
    id: 'agent',
    title: 'Your agent CLI',
    sub: 'claude, codex or agy',
    body: 'Reasons locally, spawned against the login you already have. Claude Code, Codex or Antigravity, switched with one click. No API client in the repository, no key to configure, no third-party relay.',
  },
]

export const MODES = [
  {
    id: 'site-maps',
    tab: 'Crawl & map',
    kicker: 'Automated site discovery',
    title: 'Any web app maps itself, in a few minutes',
    body: 'An agent that has never seen your site burns its first minutes rediscovering it: where search lives, what a button is really called, why the list looks empty until you scroll. So let it learn the place once. Browsentic reads the site’s own robots.txt and sitemap.xml, looks up public background on the domain, then explores for a few minutes, screenshotting as it goes. From then on every instruction on that domain arrives already knowing its way around. Elsewhere those notes stay inert.',
    invocation: '@site-mapper map this site',
    points: [
      ['Nothing takes effect until you say so', 'A map in flight is written to a staging directory the skill loader cannot read. An unreviewed map is not merely unused, it is never opened.'],
      ['You read the exact markdown', 'The panel shows it as plain text, never rendered, alongside the domain it will match. Activate arms it, Discard deletes it.'],
      ['Read-only and locked to one host', 'It cannot click, fill or submit, cannot leave the site, and stays pinned to the tab it started in. Switching tabs stops it rather than following you.'],
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
    tab: 'Record & replay',
    kicker: 'Record once, replay later',
    title: 'A site map teaches it the site. A recording teaches it your job',
    body: 'Press record in the composer, then work through the job yourself. Click across the pages, fill the fields, submit the form, press stop. Browsentic breaks what you did into ordered steps, names each one after what you accomplished, and keeps them in a list you can rename. That is a browsing skill of your own making. From then on, “do it like last time” is the whole instruction.',
    invocation: 'record my browsing session',
    points: [
      ['What you type is not saved by default', 'Every field you fill becomes a placeholder ({{email}}, {{invoice_number}}) and the assistant asks you for the value when it replays.'],
      ['Some things are never stored either way', 'Passwords, hidden fields, one-time codes and anything shaped like a card number are dropped whether or not you opt in to literal values.'],
      ['Replaying is not blind playback', 'The steps are a plan, not a script. The agent re-checks each target against the live page and prefers the visible text it recorded over the CSS selector, because selectors are what a redesign breaks first.'],
      ['It stops rather than improvising', 'If a step no longer lands, the run halts and tells you which one, instead of finding a different route to the same effect.'],
    ],
    tree: [
      ['Recording · 15 min ceiling', 'warns at 13, stops itself at the limit'],
      ['✓ Step 1', 'Open the invoices list'],
      ['✓ Step 2', 'Filter to unpaid'],
      ['✓ Step 3', 'Fill {{invoice_number}}'],
      ['● Step 4', 'Submit (waits for your approval)'],
    ],
  },
  {
    id: 'instant',
    tab: 'Intent routing',
    kicker: 'Local intent classification',
    title: '“Go back” should not cost a round trip to a language model',
    body: 'So every instruction is scored against a local grammar first. Confident single-step commands run in the browser and stop there, marked with a bolt on the timeline. Everything else goes to the agent with the text untouched. The bias is deliberately toward escalating, because the two mistakes are not symmetric: escalating something it could have handled costs a round trip, while acting on something it misread spends a wrong click on your real page.',
    invocation: 'yarn check:intent "take me to the checkout page"',
    points: [
      ['Runs locally, in milliseconds', 'back, forward, reload · open github.com · scroll to the top · press enter · click Sign in · google something · stop recording'],
      ['Goes to the agent', '“is there a login button?” · “open the settings menu” · “click Buy now” · “scroll down and tell me what it says” · “click it”'],
      ['Questions always escalate', 'So do multi-step asks, conditionals, vague targets and consequential clicks, as does any local command that runs and fails.'],
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
    body: 'Any web page can open a WebSocket to loopback, so the daemon first classifies the peer by handshake Origin, which browsers set themselves and pages cannot forge, then requires a pairing token or a session key bound to that same origin. A web page can never reach the control path.',
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
    body: 'Pairing keys, logs, config, skills and screenshots live under ~/.browsentic and ~/browsentic. Never in your checkout, never in a commit.',
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
    body: 'The extension and the daemon are separate packages. One command installs and builds both. It needs nothing on your PATH but Node 20+, because the pinned Yarn release ships in the repository.',
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
    body: 'The pairing code is single-use and lives for ten minutes. Paste it into the popup and press Connect. The daemon then issues a long-lived session key that survives browser and daemon restarts, and dies only when you revoke it.',
    code: 'yarn mcp:link        # global npm prefix, so it stays a separate step\nbrowsentic-mcp pair  # prints a single-use code, valid for 10 minutes',
    lang: 'sh',
  },
  {
    n: '04',
    title: 'Point any MCP client at the same browser',
    body: 'Your agent now commands 35 page tools plus browsentic_status, and three read-only resources that hand back page context without spending a tool call.',
    code: 'claude mcp add browsentic -- browsentic-mcp',
    lang: 'sh',
  },
]

export const FAQ = [
  {
    q: 'Do I need an API key?',
    a: 'No. Browsentic runs on the agent CLI login you already have: Claude Code, Codex or Antigravity. There is no API client anywhere in the repository and nothing to paste into a settings field. The daemon spawns your chosen CLI locally, as you.',
  },
  {
    q: 'Is this a headless browser?',
    a: 'The opposite. It drives the real, logged-in tab in front of you: your sessions, your cookies, your extensions, your two-factor state. Nothing has to be re-authenticated in a throwaway profile.',
  },
  {
    q: 'What stops a random web page from driving my browser?',
    a: 'Two gates. The daemon classifies every WebSocket peer by its handshake Origin, which the browser sets and a page cannot forge, and then still requires a pairing token or an origin-bound session key. A page fails the first gate and never reaches the second.',
  },
  {
    q: 'Can I use it from something other than Claude Code?',
    a: 'Yes. The daemon speaks MCP over stdio, so any MCP client drives the same browser: Codex, Antigravity, Cursor, Zed, Claude Desktop. Run claude mcp add browsentic -- browsentic-mcp, or the equivalent in your client. Tool definitions are generated from the same registry the extension ships, so they cannot drift from what the browser can actually do. The side panel is switchable too: it runs on Claude Code, Codex or Antigravity, picked from the popup with one click.',
  },
  {
    q: 'Which browsers work?',
    a: 'Chrome or any Chromium browser via Manifest V3, and Firefox builds work too. You will need Node.js 20 or newer, and one agent CLI on your PATH: claude, codex or agy.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. It is MIT licensed and open source. The only cost is whatever your existing agent subscription already costs you.',
  },
  {
    q: 'How do I add a capability?',
    a: 'One module in lib/actions/page/ and one line in the registry, which publishes it as an MCP tool at the same time. That is the whole of creating your own browsing action. Four conventions in an action module are load-bearing at runtime: touch document and window only inside execute(), keep underscores out of action names, describe() every input field, and validate with ActionError inside execute() rather than a zod refine or transform.',
  },
]

export const NAV_LINKS = [
  { href: '#how', label: 'Architecture' },
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#teach', label: 'Skills' },
  { href: '#mcp', label: 'MCP' },
  { href: '#security', label: 'Security' },
  { href: '#start', label: 'Quickstart' },
]
