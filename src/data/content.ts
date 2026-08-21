// Sourced from the repository README and docs/. Components hold no copy of their own.

export const REPO = 'https://github.com/imshaikot/browsentic'
export const VERSION = 'v0.2.1'

export const SEO = {
  title: 'Browsentic: AI browser automation in your own browser',
  description:
    'No new browser, no new subscription. Hand any tab to the AI agent you already run: 35 page tools over MCP, in the logged-in session you already use.',
  social: {
    title: 'Browsentic: every tab, its own AI agent',
    description:
      'Hand any tab to Claude Code, Codex or Antigravity. 35 page tools, three tabs automated at once, record and replay, site maps. Local only, no API key.',
  },
  imageAlt:
    'Browsentic. Every tab, its own AI agent. 35 page tools, three runs at once, record and replay, site maps, no API key.',
  author: 'imshaikot',
  summary:
    'A browser extension plus a local daemon that hands your real, logged-in browser tab to the AI agent CLI you already run, or to any MCP client, by voice, by typing, or by replaying a session you recorded once.',
  keywords: [
    'AI browser automation',
    'browser automation',
    'AI browser agent',
    'agentic browsing',
    'browser automation without API key',
    'MCP server',
    'Model Context Protocol',
    'Claude Code browser automation',
    'browser extension',
    'Chrome extension',
    'web automation',
    'automate job applications',
    'record and replay browser',
    'site mapping',
  ],
} as const

export const HERO = {
  badge: 'MIT licensed, and it runs on the agent CLI you already pay for: Claude Code, Codex or Antigravity',
  title: { lead: 'Every tab,', tail: 'its own ', accent: 'AI agent' },
  lede: 'No new browser. No new subscription. Hand any tab to the AI agent you already run and it reads the page, clicks, fills and finishes the job in the session you are already signed in to. The web work you grind through by hand, automated where you already browse.',
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
    title: ['35 page tools: read a page,', 'act on it, and wait it out'],
    lede: 'Perceiving the page as structure rather than pixels: a layout diagram, stable selectors, rendered text, screenshots. Listening while you talk it through. Sensing progress and waiting out an upload or a deploy so you never have to hover over it. Then acting with a human hand, and remembering enough to run the whole thing again unprompted. Aim by CSS selector, visible text, ARIA role or index, because visible text outlives the redesigns that break selectors.',
  },
  orchestrate: {
    kicker: 'Agent orchestration',
    title: ['Several tabs, several agents,', 'one browser, all at once'],
    lede: 'A conversation belongs to the tab it started in, not to whatever you happen to be looking at. Start one in the tab that is uploading, another in the tab that is answering support, a third watching a deploy, then go and read something else. Each keeps to its own tab, reports on its own timeline, and stops for you on its own terms.',
  },
  automations: {
    kicker: 'In practice',
    title: ['Jobs people actually hand over,', 'and where each one stops for you'],
    lede: 'Ordinary browsing work, in sites you are already signed in to: the negotiation, the application, the cancellation, the thing you redo every Friday. The agent does the reading, the typing and the clicking. Anything that commits something or sends it to someone else pauses first, naming the action, and waits for you.',
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

export type RunStep = { tool: string; note: string; ms: number; gate?: boolean }

export type OrchestrationRun = {
  id: string
  host: string
  task: string
  /** Milliseconds into the loop when a slot frees up for this run. */
  start: number
  result: string
  steps: RunStep[]
}

/**
 * The board animates one loop of four tab sessions. Three run at a time, which is the
 * real default, so the fourth waits for the first to finish before it starts.
 */
export const ORCHESTRATION_RUNS: OrchestrationRun[] = [
  {
    id: 'billing',
    host: 'app.acme.com',
    task: 'Chase the six invoices that went past due',
    start: 0,
    result: 'six reminders sent',
    steps: [
      { tool: 'page_getPageInfo', note: 'invoices · 6 unpaid, 41 interactive elements', ms: 1200 },
      { tool: 'page_selectOption', note: 'status → Unpaid', ms: 1100 },
      { tool: 'page_fillInput', note: 'reminder note · due 12 Aug', ms: 1200 },
      { tool: 'page_submitForm', note: 'Send reminders', ms: 2000, gate: true },
      { tool: 'page_extractText', note: 'confirmation · 6 of 6 delivered', ms: 1200 },
    ],
  },
  {
    id: 'support',
    host: 'help.vendor.io',
    task: 'Argue the renewal back down to last year',
    start: 900,
    result: 'counteroffer drafted, sent on your Allow',
    steps: [
      { tool: 'page_getPageInfo', note: 'ticket 8841 · 14 messages', ms: 1200 },
      { tool: 'page_extractText', note: 'what support actually offered', ms: 1800 },
      { tool: 'page_typeText', note: 'counteroffer · your words, their numbers', ms: 2000 },
      { tool: 'page_submitForm', note: 'Send message', ms: 2200, gate: true },
    ],
  },
  {
    id: 'deploy',
    host: 'dash.deploys.dev',
    task: 'Watch the release and say when it lands',
    start: 400,
    result: 'landed in 4m 12s',
    steps: [
      { tool: 'page_startMonitor', note: 'build 2291 · pinned to this tab', ms: 1100 },
      { tool: 'page_awaitMonitor', note: 'long-polling · 62% · eta 1m 40s', ms: 6500 },
      { tool: 'page_extractText', note: 'release notes · 12 commits', ms: 1000 },
    ],
  },
  {
    id: 'jobs',
    host: 'jobs.acme.com',
    task: 'Apply with the resume you attached',
    start: 6700,
    result: 'submitted · 1 of 6 on this board',
    steps: [
      { tool: 'page_getPageInfo', note: 'application form · 22 fields', ms: 1200 },
      { tool: 'page_fillInput', note: 'experience · matched to your resume', ms: 1500 },
      { tool: 'page_attachFile', note: 'resume.pdf → #cv-upload', ms: 1800, gate: true },
      { tool: 'page_submitForm', note: 'Submit application', ms: 2000, gate: true },
    ],
  },
]

export const ORCHESTRATION_POINTS: [string, string][] = [
  [
    'A run belongs to its tab, not to your attention',
    'The conversation is bound to the tab it started in. It keeps working there while you read something else, its actions land there rather than in whichever tab is in front, and moving to a tab it was not pointed at is a gated action.',
  ],
  [
    'Two runs never share a tab',
    'A tab another conversation has claimed answers TAB_IN_USE. Tabs a run opens for itself join that same session as subtabs, so everything it did stays in one transcript.',
  ],
  [
    'Three at a time, eight open',
    'Three runs go at once by default and eight tab sessions can be open, so the fourth waits for a slot instead of crowding the browser. Raise maxConcurrentRuns as far as eight.',
  ],
  [
    'Cancelling one leaves the rest running',
    'Stop the run you are looking at and the others carry on. Close a tab and only that session ends, with its transcript moved to History. A pulsing dot on the toolbar icon and on the tab’s own favicon marks whatever is still working.',
  ],
]

export const ORCHESTRATION_SHARED = {
  chip: 'shared link',
  body: 'One daemon owns the browser link, so panel runs and MCP clients interleave on the same tabs. Claude Code in one terminal, Codex in another, Cursor or Zed alongside them: they drive the browser you are already signed into, and every call they make shows up on the timeline marked external.',
}

export type Automation = {
  id: string
  title: string
  body: string
  accent: ToolGroup['accent']
  tools: string[]
  gate: string
}

export const AUTOMATION_FEATURED = {
  kicker: 'Worked example',
  title: 'Find the job, then apply as you',
  body: 'Attach your resume once. Browsentic reads it at attach time and keeps notes, so the agent knows what it is sending without ever seeing your filesystem. From then on it reads the posting in front of it, weighs it against what you have actually done, fills the application in your own words, and puts the file into the upload field. Both of the steps that reach the employer stop and ask you first, by name.',
  result: 'Submitted · 1 of 6 postings on this board',
  gates: ['file-upload · page_attachFile', 'form-submission · page_submitForm'],
  steps: [
    { tool: 'page_listFiles', note: 'resume.pdf · read once, at attach time', ms: 1500 },
    { tool: 'page_getPageInfo', note: 'application form · 22 fields, 3 required', ms: 1600 },
    { tool: 'page_fillInput', note: 'experience · matched to your resume', ms: 1800 },
    { tool: 'page_attachFile', note: 'resume.pdf → #cv-upload', ms: 2400, gate: true },
    { tool: 'page_submitForm', note: 'Submit application', ms: 2600, gate: true },
  ] as RunStep[],
}

export const AUTOMATIONS: Automation[] = [
  {
    id: 'support',
    title: 'Negotiate, in the chat you are already signed into',
    body: 'Your account, your ticket history, last year’s invoice open in the next tab. It reads what support actually said, drafts the counteroffer with the numbers in front of it, and holds at the button that sends it, because the message is the part that reaches someone else.',
    accent: 'ember',
    tools: ['page_extractText', 'page_typeText', 'page_submitForm'],
    gate: 'Pauses at Send, under the form-submission rule',
  },
  {
    id: 'cancel',
    title: 'Cancel the things you stopped using',
    body: 'Point it at a billing page and it finds the cancellation flow, reads past the retention offer, answers the exit survey and walks up to the click that actually cancels. The consequence is the last step, so that is the step you keep.',
    accent: 'magenta',
    tools: ['page_getPageInfo', 'page_clickElement', 'page_extractText'],
    gate: 'Name page_clickElement in requireApproval and the last click asks first',
  },
  {
    id: 'watch',
    title: 'Sit through the slow part so you do not have to',
    body: 'Start the upload, the build or the export, then hand the tab over. It reads the progress signals the page gives off, tracks percent and ETA in the background, and tells you the moment it lands. Nobody has to hover over a bar that moves once a minute.',
    accent: 'lime',
    tools: ['page_startMonitor', 'page_awaitMonitor', 'page_monitorStatus'],
    gate: 'Nothing to approve. It is only watching',
  },
  {
    id: 'repeat',
    title: 'Do Friday’s expense report like last time',
    body: 'Work through it yourself once with the recorder on. Browsentic keeps ordered steps named after what you accomplished, and the values you typed come back as placeholders it asks you to fill. Next Friday the whole instruction is “do it like last time”.',
    accent: 'amber',
    tools: ['page_listRecordings', 'page_readRecording', 'page_fillInput'],
    gate: 'Replay is a plan, not a script. A step that no longer lands halts the run',
  },
  {
    id: 'digest',
    title: 'Pull the week out of five dashboards',
    body: 'Five tools you are logged into, one summary. It reads each one as rendered text, the way you would read it, rather than scraping markup full of hidden nodes and off-screen strings that never met your eyes.',
    accent: 'brand',
    tools: ['page_extractText', 'page_screenshot', 'page_openTab'],
    gate: 'Raw HTML reads are denied by default, hidden text with them',
  },
  {
    id: 'bulk',
    title: 'Work a list, one record at a time',
    body: 'The same twelve fields across forty rows: the job nobody schedules and everybody postpones. It fills each record, submits, checks what came back, and moves on, stopping the moment a page stops looking like the one before it.',
    accent: 'brand-deep',
    tools: ['page_fillInput', 'page_submitForm', 'page_waitForElement'],
    gate: 'Asks on every submit, until you grant Always on this host',
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
    q: 'Can it automate several tabs at the same time?',
    a: 'Yes. Every tab gets its own conversation, bound to the tab it started in, so a run keeps working there while you read something else instead of following whichever tab is in front. Eight tab sessions can be open and three run at once by default, raised as far as eight with maxConcurrentRuns. A fourth waits for a slot, cancelling one leaves the rest running, and a tab another conversation has claimed answers TAB_IN_USE.',
  },
  {
    q: 'What can I actually automate with it?',
    a: 'Ordinary browsing work on sites you are already signed in to: negotiating a renewal in a support chat that already has your ticket history, filling and submitting a job application from a resume you attached, walking a cancellation flow to its last click, watching a slow deploy and reporting when it lands, redoing Friday’s expense report from a recording, or pulling one summary out of five dashboards. Anything that commits something or sends data somewhere pauses and names the action before it happens.',
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
  { href: '#orchestrate', label: 'Orchestration' },
  { href: '#automations', label: 'Automations' },
  { href: '#teach', label: 'Skills' },
  { href: '#security', label: 'Security' },
  { href: '#start', label: 'Quickstart' },
]
