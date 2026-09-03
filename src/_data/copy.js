// The single source of every fact on the site. Sourced from the repository README
// and docs/. Templates hold no copy of their own.

export const REPO = 'https://github.com/imshaikot/browsentic'
export const VERSION = 'v0.4.12'

export const SEO = {
  title: 'Browsentic: AI browser automation in your own browser',
  description:
    'No new browser, no API key. A browser extension that hands your tabs to the AI agent you already run, inside the logged-in session you already use.',
  social: {
    title: 'Browsentic: no new browser, no API key',
    description:
      'Like Claude Code for your browser, except it can see the page. Record and replay, autonomous site maps, several tabs at once. Local only, MIT.',
  },
  imageAlt:
    'Browsentic. No new browser, no API key. Your tabs, your own AI agent. Record and replay, autonomous site maps, several tabs at once, MIT licensed.',
  author: 'imshaikot',
  summary:
    'A browser extension and a local daemon that hand your real, logged-in tab to the AI agent you already run. It also speaks MCP, so your terminal can drive the same browser.',
  keywords: [
    'AI browser automation',
    'browser AI agent',
    'browser extension AI',
    'AI browser extension for Chrome',
    'automate logged-in browser',
    'record and replay browser',
    'agentic browsing',
    'browser automation without API key',
    'browser automation',
    'web automation',
    'automate job applications',
    'site mapping',
    'Claude Code browser automation',
    'MCP server',
    'WebMCP',
    'WebMCP client',
  ],
}

export const HERO = {
  badge: 'MIT licensed. It runs on the agent you already pay for: Claude Code, Codex or Antigravity.',
  title: { lead: 'No new browser. No API key.', tail: 'Your tabs, ', accent: 'your own AI agent' },
  lede: 'Say what you want in the side panel. The agent you already run drives the tab in front of you, inside the session you are signed in to. It shows its work and asks before anything that counts.',
  voice: 'or open the panel and say it out loud',
  command: 'claude mcp add browsentic -- browsentic mcp',
}

/**
 * Not two equal doors. The extension is the product: you install it, and the side
 * panel is where the work happens. MCP is an optional integration for people who
 * already live in a terminal, which is why the second card is smaller and quieter.
 */
export const HERO_PATHS = [
  {
    id: 'extension',
    kicker: 'The product',
    title: 'Install the browser extension',
    body: 'A side panel in Chrome or any Chromium browser. Speak to it, type at it, or press record and show it a job once.',
    command: 'npx browsentic setup',
    cta: { href: '/install/', label: 'Install the extension' },
    accent: 'brand',
  },
  {
    id: 'mcp',
    kicker: 'Optional',
    title: 'If you already live in a terminal',
    body: 'The same paired browser also answers an MCP client. Nothing you need on day one.',
    cta: { href: '/mcp-server/', label: 'MCP server setup' },
    accent: 'brand-deep',
  },
]

/**
 * The scripted run the hero plays on a loop: a prompt typed into the side panel,
 * then tool calls streaming back while the matching element on the faux page
 * lights up. `focus` names the element each step reaches for.
 */
export const HERO_DEMO = {
  url: 'app.acme.com/billing',
  prompt: 'find the unpaid invoices and open the newest one',
  steps: [
    { tool: 'page_getPageInfo', detail: 'snapshot of the billing page', kind: 'agent', ms: 1100 },
    { tool: 'page_clickElement', detail: 'text: "Invoices"', kind: 'agent', focus: 'nav', ms: 1000 },
    { tool: 'page_selectOption', detail: 'status → Unpaid', kind: 'agent', focus: 'filter', ms: 1000 },
    { tool: 'page_submitForm', detail: 'waiting for your approval', kind: 'approval', focus: 'submit', ms: 1900 },
    { tool: 'page_scrollTo', detail: 'top of results', kind: 'local', ms: 800 },
    { tool: 'page_clickElement', detail: 'row 1 · INV-2291', kind: 'agent', focus: 'row', ms: 1000 },
    { tool: 'Answer', detail: 'INV-2291 · $4,120 · issued 12 Aug · 6 days overdue', kind: 'answer', ms: 3400 },
  ],
  nav: ['Overview', 'Invoices', 'Customers', 'Settings'],
  rows: [
    { id: 'INV-2291', amount: '$4,120' },
    { id: 'INV-2288', amount: '$980' },
    { id: 'INV-2280', amount: '$2,410' },
    { id: 'INV-2274', amount: '$610' },
  ],
}

export const SECTIONS = {
  how: {
    kicker: 'Architecture',
    title: ['Four hops, and every one of them', 'is on your machine'],
    lede: 'No relay, no hosted runner, no browser in someone else’s data centre. The extension dials out to a daemon on loopback, and one daemon owns the browser link.',
  },
  capabilities: {
    kicker: 'Capabilities',
    title: ['Sense the page, act on it,', 'and wait out the slow parts'],
    lede: 'It reads the page as structure rather than pixels: a layout diagram, stable selectors, rendered text, screenshots. Then it acts with a human hand, and sits through the slow parts so you do not have to.',
  },
  orchestrate: {
    kicker: 'Agent orchestration',
    title: ['Several tabs, several agents,', 'one browser, all at once'],
    lede: 'A conversation belongs to the tab it started in, not to whatever you happen to be looking at. Start one, walk away, start another. Each carries on where it began.',
  },
  automations: {
    kicker: 'In practice',
    title: ['Jobs people actually hand over,', 'and where each one stops for you'],
    lede: 'Ordinary work on sites you are already signed in to. The agent works out what the job needs and sees it through, then stops before anything that reaches someone else.',
  },
  teach: {
    kicker: 'Skills',
    title: ['Map any web app automatically,', 'then keep it as your own skill'],
    lede: 'Point it at a site and it maps itself. Show it a job once and it keeps the steps. Both become skills you read before you arm them.',
  },
  panel: {
    kicker: 'The extension',
    title: ['Everything happens in the side panel', 'of the browser you already have open'],
    lede: 'Install it, pair it once, and the panel opens beside whatever tab you are on. It reads the page you are actually looking at and asks before anything commits.',
  },
  mcp: {
    kicker: 'Optional integration',
    title: ['The browser MCP server, for when', 'you already live in a terminal'],
    lede: 'The side panel needs none of this. But the daemon also speaks MCP, so Claude Code, Codex, Cursor or Zed can take the wheel of the same real tab.',
  },
  highlights: {
    kicker: 'What it does',
    title: ['What handing over a tab', 'actually gets you'],
    lede: 'All of it ships in the extension, works on the sites you are already signed in to, and stops for you at anything that counts.',
  },
  security: {
    kicker: 'Security model',
    title: 'An agent driving your real browser has to earn it',
    lede: 'These are properties of how it is built, not promises in a policy document. A local daemon, an extension that dials out to it, and nobody in between.',
  },
  start: {
    kicker: 'Quickstart',
    title: 'One command, then two things only you can do',
    lede: 'You need a Chromium browser, Node.js 20 or newer, and one agent CLI on your PATH. Nothing to clone, nothing to compile.',
  },
  faq: {
    kicker: 'FAQ',
    title: 'The ones people ask first',
  },
  compare: {
    kicker: 'Comparison',
    title: ['Claude in Chrome extends Claude.', 'Browsentic extends your browser.'],
    lede: 'Anthropic puts Claude in a Chrome side panel. Browsentic starts from the other end: your browser, handed to whichever agent you already run. Here is where each one wins.',
  },
}

export const CTA = {
  title: { lead: 'Stop describing the page.', accent: 'Hand it over.' },
  lede: 'Free and MIT licensed. No signup, no key to paste, and a fresh install connects to nothing until you pair it yourself.',
  command: 'npx browsentic setup',
}

/**
 * The band under the hero. It used to be four animated numerals, which read as a
 * pitch deck. These are the four things that are actually true about the product.
 */
export const PROOF = [
  { label: 'Runs on your machine', note: 'a local daemon on loopback, nothing hosted' },
  { label: 'No API key', note: 'it spawns the agent CLI you already signed in to' },
  { label: 'Your logged-in session', note: 'your cookies, your two-factor, your extensions' },
  { label: 'Open source', note: 'MIT licensed, and free' },
]

/** What the side panel actually is, in the space the integration cards used to hold. */
export const PANEL_POINTS = [
  {
    id: 'input',
    title: 'Speak it, type it, or show it once',
    body: 'Dictate in the side panel, hold to talk in the popup, or just type. Work a tedious job through yourself with the recorder on and it keeps every step.',
  },
  {
    id: 'sessions',
    title: 'A session per tab, working in the background',
    body: 'The conversation belongs to the tab it started in and carries on there while you read something else. A pulsing dot marks whatever is still at work.',
  },
  {
    id: 'approvals',
    title: 'Approvals surface where you are looking',
    body: 'Anything that commits, or reaches someone other than you, pauses in the panel and names itself first. Cancelling stops a run mid-flight.',
  },
  {
    id: 'agent',
    title: 'Your agent, switched with one click',
    body: 'The panel runs on Claude Code, Codex or Antigravity, picked from the popup, down to the model. No key to paste: it spawns the CLI you already signed in to.',
  },
]

/** One band on the home page, pointing at the page that owns the integration. */
export const MCP_BAND = {
  chip: 'Also an MCP server',
  body: 'Already using an MCP client? It works there too. One command hands Claude Code, Codex, Cursor or Zed the same paired browser.',
  cta: { href: '/mcp-server/', label: 'MCP server setup' },
}

export const MCP_POINTS = [
  {
    id: 'clients',
    title: 'Any MCP client, one browser',
    body: 'The daemon speaks MCP over stdio, so anything fluent in the protocol drives the same logged-in browser. Several at once, because one daemon owns the link.',
  },
  {
    id: 'manifest',
    title: 'The manifest cannot drift',
    body: 'Tool definitions are generated from the same registry the extension ships. A tool that describes something the browser cannot do is not a bug you can write.',
  },
  {
    id: 'extend',
    title: 'Create your own action in one file',
    body: 'A module under src/lib/actions/page/ plus one line in the registry, and it publishes as an MCP tool at the same time.',
  },
]

export const TOOL_GROUPS = [
  {
    id: 'read',
    label: 'Read',
    accent: 'brand',
    blurb:
      'Takes the page in as structure: a layout diagram with stable selectors, rendered text, screenshots, the search box wherever a site hid it. When it cannot name the thing you mean, it hands you the lens.',
    tools: [
      'page_getPageInfo',
      'page_extractText',
      'page_waitForElement',
      'page_findProgress',
      'page_findSearch',
      'page_pickElement',
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
      'Reaches into the page with a human hand. Point, hover, drag, focus, fill, type at a human pace, choose an option, select a passage, press keys, commit a form. Real browser gestures where a synthetic one is refused.',
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
    id: 'script',
    label: 'Script',
    accent: 'magenta',
    blurb:
      'Writes its own tool when the fixed set is the wrong shape. A job that repeats twenty times becomes a small script drafted for that page, which you read and approve before a line of it runs. Off until you turn it on, and never available to an MCP client.',
    tools: ['page_injectCode', 'page_runCode'],
  },
  {
    id: 'site-tools',
    label: 'Site tools',
    accent: 'brand',
    blurb:
      'Takes a site up on its own offer. Where a page registers WebMCP tools for agents, the snapshot says so, and one schema-checked call into the site’s own code replaces a click sequence a redesign could break.',
    tools: ['page_listSiteTools', 'page_callSiteTool'],
  },
  {
    id: 'move',
    label: 'Navigate',
    accent: 'magenta',
    blurb:
      'Finds its own way around. Open a URL, go back and forward, reload, search a site on its own terms, scroll to what matters, spawn a tab, close the ones it is finished with.',
    tools: ['page_navigate', 'page_searchSite', 'page_scrollTo', 'page_openTab', 'page_switchTab', 'page_closeTab'],
  },
  {
    id: 'wait',
    label: 'Wait',
    accent: 'lime',
    blurb:
      'Watches an upload, a build or a deploy from the background, keeping percent and ETA in view. When a page offers nothing to watch, it works to a clock instead and tells you only what changed.',
    tools: [
      'page_startMonitor',
      'page_monitorStatus',
      'page_awaitMonitor',
      'page_stopMonitor',
      'page_startTimer',
      'page_timerStatus',
      'page_stopTimer',
    ],
  },
  {
    id: 'diagnose',
    label: 'Diagnose',
    accent: 'ember',
    blurb:
      'Reads what the page reports rather than what it shows: console messages, uncaught exceptions, failed requests and their timings. The difference between “the button did nothing” and “the POST behind it returned a 500”.',
    tools: ['page_startDiagnostics', 'page_readConsole', 'page_readNetwork', 'page_stopDiagnostics'],
  },
  {
    id: 'files',
    label: 'Files',
    accent: 'amber',
    blurb:
      'Moves files both ways. Hands one you attached to a file input, and captures the file a click produces, sealed on disk and ready to upload elsewhere.',
    tools: ['page_listFiles', 'page_attachFile', 'page_captureDownload', 'page_listDownloads'],
  },
  {
    id: 'recordings',
    label: 'Recordings',
    accent: 'brand-deep',
    blurb:
      'Recalls the sessions you recorded and replays them as ordered steps, re-checking every target against the live page before it commits to acting.',
    tools: ['page_listRecordings', 'page_readRecording'],
  },
]

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
    body: 'Dictate in the side panel, hold to talk in the popup, or just type. Work a tedious job through yourself once and it keeps every step.',
  },
  {
    id: 'extension',
    title: 'Extension',
    sub: 'Manifest V3, Chrome and Chromium',
    body: 'Weighs your instruction against a local grammar before anyone spends a token. Confident one-step commands fire right here. Everything else travels on untouched.',
  },
  {
    id: 'daemon',
    title: 'Daemon',
    sub: 'Local WebSocket, loopback only',
    body: 'The extension dials out, because an MV3 service worker cannot listen. One daemon owns the browser link, so several clients can share one browser.',
  },
  {
    id: 'agent',
    title: 'Your agent CLI',
    sub: 'claude, codex or agy',
    body: 'Reasons locally, spawned against the login you already have. Claude Code, Codex or Antigravity, switched with one click. No key to configure, no third-party relay.',
  },
]

/**
 * The board is drawn from the extension outwards: four tab sessions, the panel that
 * follows whichever tab is in front, then the one local link out to the daemon and the
 * agents it wakes. Three sessions are live, which is the real default, so the fourth waits.
 */
export const ORCHESTRATION_SESSIONS = [
  {
    id: 'billing',
    host: 'app.acme.com',
    tab: 'Invoices',
    title: 'Six invoices gone past due',
    agent: 'claude',
    status: 'working',
    timeline: [
      'sees six invoices past due',
      'takes in the terms agreed on each',
      'wording the reminders now',
    ],
  },
  {
    id: 'support',
    host: 'help.vendor.io',
    tab: 'Ticket 8841',
    title: 'The renewal, argued back down',
    agent: 'codex',
    status: 'approval',
    timeline: [
      'read fourteen messages of history',
      'weighed the offer against last year',
      'waiting on you before it reaches them',
    ],
  },
  {
    id: 'deploy',
    host: 'dash.deploys.dev',
    tab: 'Release 2291',
    title: 'Watching the release land',
    agent: 'claude',
    status: 'working',
    timeline: [
      'senses the progress the page gives off',
      'pinned to this tab, in the background',
      'about a minute to go',
    ],
  },
  {
    id: 'jobs',
    host: 'jobs.acme.com',
    tab: 'Application',
    title: 'Applying with the resume you attached',
    agent: 'agy',
    status: 'queued',
    timeline: ['holding for a slot', 'three sessions already at work'],
  },
]

export const ORCHESTRATION_CHAIN = {
  out: 'what you asked for',
  back: 'what it saw and did',
  daemon: {
    title: 'One local daemon',
    sub: '127.0.0.1 · loopback only',
    body: 'Nothing listens inside the browser. The extension opens the link itself, and one daemon owns it however many sessions are in flight.',
  },
  agents: {
    title: 'One agent per session',
    sub: 'all slots in use',
    body: 'Woken as you, on the CLI you already signed in to, and told about this session and no other.',
  },
}

export const ORCHESTRATION_POINTS = [
  [
    'A session belongs to its tab, not to your attention',
    'It is bound to the tab it started in and carries on there while you look at something else. Reaching into a tab it was never pointed at is a gated action.',
  ],
  [
    'Two sessions never share a tab',
    'A tab another conversation has claimed answers TAB_IN_USE. Tabs a session opens for itself join that same session, so everything it did stays in one transcript.',
  ],
  [
    'Three at a time, eight open',
    'Three sessions work at once by default, so the fourth holds for a slot instead of crowding the browser. Raise maxConcurrentRuns as far as eight.',
  ],
  [
    'Stopping one leaves the rest alone',
    'End the session in front of you and the others carry on. Close a tab and only that one ends, with its transcript moved to History.',
  ],
]

export const ORCHESTRATION_SHARED = {
  chip: 'shared link',
  body: 'The same link carries anything else you point at it. Claude Code in one terminal, Cursor in another: all the same browser, and every step surfaces on the timeline marked external.',
}

export const AUTOMATION_FEATURED = {
  kicker: 'Worked example',
  title: 'Find the job, then apply as you',
  body: 'Attach your resume once. Browsentic reads it there and then and keeps notes, so the agent knows what it is offering without ever seeing your filesystem. It reads the posting, answers in your own words, and hands over the file the form asks for. Both steps that reach the employer stop first.',
  result: 'Submitted · 1 of 6 postings on this board',
  gates: ['file-upload · page_attachFile', 'form-submission · page_submitForm'],
  steps: [
    { tool: 'page_listFiles', note: 'resume.pdf · read once, at attach time', ms: 1500 },
    { tool: 'page_getPageInfo', note: 'the application form, field by field', ms: 1600 },
    { tool: 'page_fillInput', note: 'experience · matched to your resume', ms: 1800 },
    { tool: 'page_attachFile', note: 'resume.pdf, where the form asks for it', ms: 2400, gate: true },
    { tool: 'page_submitForm', note: 'the step that reaches the employer', ms: 2600, gate: true },
  ],
}

export const AUTOMATIONS = [
  {
    id: 'support',
    title: 'Negotiate, in the chat you are already signed into',
    body: 'Your account, your ticket history, last year’s invoice in the next tab. It reads what support actually said, drafts the counteroffer in your own words, and holds right where it would reach them.',
    accent: 'ember',
    tools: ['page_extractText', 'page_typeText', 'page_submitForm'],
    gate: 'Pauses at Send, under the form-submission rule',
  },
  {
    id: 'cancel',
    title: 'Cancel the things you stopped using',
    body: 'It finds where the cancellation actually lives, sees the retention offer for what it is, answers the exit survey, and halts at the one step that cannot be undone.',
    accent: 'magenta',
    tools: ['page_getPageInfo', 'page_clickElement', 'page_extractText'],
    gate: 'Name page_clickElement in requireApproval and the final step asks first',
  },
  {
    id: 'watch',
    title: 'Sit through the slow part so you do not have to',
    body: 'Start the upload, the build or the export, then hand the tab over. It keeps percent and ETA in view from the background and tells you the moment it lands.',
    accent: 'lime',
    tools: ['page_startMonitor', 'page_awaitMonitor', 'page_monitorStatus'],
    gate: 'Nothing to approve. It is only watching',
  },
  {
    id: 'repeat',
    title: 'Do Friday’s expense report like last time',
    body: 'Show it once, with the recorder on. It keeps ordered steps named after what you accomplished, and whatever you typed comes back as a placeholder it asks you for.',
    accent: 'amber',
    tools: ['page_listRecordings', 'page_readRecording', 'page_fillInput'],
    gate: 'Replay is a plan, not a script. A step that no longer lands halts the run',
  },
  {
    id: 'digest',
    title: 'Pull the week out of five dashboards',
    body: 'Five tools you are logged into, one summary. It reads each as rendered text, the way it appears to you, not as markup full of hidden nodes.',
    accent: 'brand',
    tools: ['page_extractText', 'page_screenshot', 'page_openTab'],
    gate: 'Raw HTML reads are denied by default, hidden text with them',
  },
  {
    id: 'bulk',
    title: 'Work a list, one record at a time',
    body: 'The same twelve fields across forty rows: the job nobody schedules and everybody postpones. It checks each result against what it expected, and stops the moment a page stops resembling the one before.',
    accent: 'brand-deep',
    tools: ['page_fillInput', 'page_submitForm', 'page_waitForElement'],
    gate: 'Asks each time it commits one, until you grant Always on this host',
  },
]

export const MODES = [
  {
    id: 'site-maps',
    tab: 'Crawl & map',
    kicker: 'Automated site discovery',
    title: 'Any web app maps itself, in a few minutes',
    body: 'An agent that has never seen your site burns its first minutes rediscovering it. So let it learn the place once. It reads the site’s own robots.txt and sitemap.xml, then explores for a few minutes, screenshotting as it goes. Every later instruction on that domain arrives knowing its way around.',
    invocation: '@site-mapper map this site',
    points: [
      ['Nothing takes effect until you say so', 'A map in flight is written to a staging directory the skill loader cannot read. An unreviewed map is not merely unused, it is never opened.'],
      ['You read the exact markdown', 'The panel shows it as plain text, never rendered, alongside the domain it will match. Activate arms it, Discard deletes it.'],
      ['Read-only and locked to one host', 'It cannot click, fill or submit, cannot leave the site, and stays pinned to the tab it started in.'],
      ['Ceilings you can narrow, never widen', 'A short page budget and a short clock by default, under hard limits the daemon enforces above them.'],
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
    body: 'Press record, then work through the job yourself. Click across the pages, fill the fields, submit, press stop. Browsentic breaks what you did into ordered steps, each named after what you accomplished. From then on, “do it like last time” is the whole instruction.',
    invocation: 'record my browsing session',
    points: [
      ['What you type is not saved by default', 'Every field you fill becomes a placeholder ({{email}}, {{invoice_number}}) and the assistant asks you for the value when it replays.'],
      ['Some things are never stored either way', 'Passwords, hidden fields, one-time codes and anything shaped like a card number are dropped whether or not you opt in.'],
      ['Replaying is not blind playback', 'The steps are a plan, not a script. The agent re-checks each target against the live page and prefers the visible text it recorded over the CSS selector.'],
      ['It stops rather than improvising', 'If a step no longer lands, the run halts and tells you which one, instead of finding a different route to the same effect.'],
    ],
    tree: [
      ['Recording', 'stops itself at the ceiling'],
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
    body: 'So every instruction is scored against a local grammar first. Confident single-step commands run in the browser and stop there. Everything else goes to the agent untouched. The bias is toward escalating, because acting on something it misread spends a wrong click on your real page.',
    invocation: 'yarn check:intent "take me to the checkout page"',
    points: [
      ['Runs locally, in milliseconds', 'back, forward, reload · open github.com · scroll to the top · press enter · click Sign in · google something · stop recording'],
      ['Goes to the agent', '“is there a login button?” · “open the settings menu” · “click Buy now” · “scroll down and tell me what it says” · “click it”'],
      ['Questions always escalate', 'So do multi-step asks, conditionals, vague targets and consequential clicks, as does any local command that runs and fails.'],
      ['You can audit a single decision', 'Route one utterance through the grammar from the command line and see exactly why it went where it went.'],
    ],
    tree: [
      ['⚡ go back', 'local'],
      ['⚡ scroll to the top', 'local'],
      ['→ is there a login button?', 'agent'],
      ['⚡ open github.com', 'local'],
      ['→ click Buy now', 'agent · consequential'],
    ],
  },
]

/** The home page highlights: outcomes in the launch voice, each owning a deep page. */
export const HIGHLIGHTS = [
  {
    id: 'record',
    title: 'Show it a job once and it remembers',
    body: 'Press record, work through the job yourself, press stop. From then on “do it like last time” is the whole instruction, and every step is re-checked against the live page before it acts.',
    accent: 'amber',
    link: { href: '/skills/', label: 'Record and replay' },
  },
  {
    id: 'maps',
    title: 'It learns a site before it works it',
    body: 'Point it at a site and it explores on its own: reads the sitemap, walks the pages, writes itself notes. Every later session on that domain knows its way around.',
    accent: 'lime',
    link: { href: '/skills/', label: 'Automated site maps' },
  },
  {
    id: 'orchestrate',
    title: 'Several tabs, several agents, one browser',
    body: 'Each tab holds its own conversation and carries on while you read something else. Stopping one leaves the rest alone.',
    accent: 'magenta',
    link: { href: '/orchestration/', label: 'Orchestration' },
  },
  {
    id: 'lens',
    title: 'Point at what you mean',
    body: 'Press the lens and click the element you are talking about, and it rides along with your next message. When words are not enough, the agent hands the lens back.',
    accent: 'brand',
    link: { href: '/capabilities/', label: 'Targeting and the lens' },
  },
  {
    id: 'captcha',
    title: 'It does not stall at “verify you are human”',
    body: 'It recognises the widget, ticks the checkbox with a real browser gesture once you approve, and hands anything that needs a person straight to you.',
    accent: 'ember',
    link: { href: '/capabilities/', label: 'What it can read' },
  },
  {
    id: 'live',
    title: 'Create your own agent tool',
    body: 'Ask for what no built-in tool does. Read the code the agent writes, keep it, and it runs by name on that site from then on.',
    accent: 'magenta',
    link: { href: '/live-tools/', label: 'Make your own tool' },
  },
  {
    id: 'skills',
    title: 'Teach it your own moves',
    body: 'Write a skill in plain markdown and drop it in, or let a mapped site or a recording become one. Nothing arms itself until you have read it.',
    accent: 'brand-deep',
    link: { href: '/skills/', label: 'Skills' },
  },
]

export const SECURITY = [
  {
    title: 'Off by default',
    body: 'A fresh install connects to nothing. An unpaired extension never contacts the daemon, and pairing takes a single-use code you redeem yourself.',
  },
  {
    title: 'Two independent gates',
    body: 'Any web page can open a WebSocket to loopback, so the daemon first classifies the peer by handshake Origin, which a page cannot forge, then still requires a pairing token or an origin-bound session key.',
  },
  {
    title: 'Consequential actions ask first',
    body: 'Approvals appear in the panel with the action named. Form submission is gated by default, because it is the one effect that reaches someone other than you. Cancelling stops a run mid-flight.',
  },
  {
    title: 'Agent-written code is read before it runs',
    body: 'The Live tool switch starts off, and with it off the agent is not told the tools exist. Any script it writes arrives as an approval showing the full source. What you approve is that code, on that tab and that site.',
  },
  {
    title: 'Recordings capture what you do, not what you type',
    body: 'A recording stores the identity of each field and a placeholder for its value. Keeping literal values is per-recording and off by default.',
  },
  {
    title: 'Speech uses the browser’s own recognition',
    body: 'No model is bundled and nothing is downloaded. Chrome’s Web Speech API does the transcription, and replacing the engine is a one-file change.',
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

/**
 * /vs-claude-in-chrome/. Every claim about Claude in Chrome comes from
 * Anthropic’s own announcement and help center, last checked August 2026.
 * Their product moves; when it does, this is the file to fix.
 */
export const COMPARISON = {
  checked: 'August 2026',
  axis: {
    them: {
      title: 'Claude in Chrome',
      tagline: 'Claude, extended into your browser',
      points: [
        'Anthropic’s agent, thinking in Anthropic’s cloud, acting through a Chrome side panel',
        'Included with the paid Claude plans: Pro, Max, Team and Enterprise',
        'One click to install from the Chrome Web Store',
        'At home if you already live in claude.ai and want the same Claude everywhere',
      ],
    },
    us: {
      title: 'Browsentic',
      tagline: 'Your browser, extended into the agent you already run',
      points: [
        'Runs on the agent CLI you already pay for: Claude Code, Codex or Antigravity, switchable in one click',
        'No account, no API key, no cloud service, no telemetry',
        'Doubles as an MCP server, so Claude Code, Cursor or Zed drives the same logged-in tab',
        'MIT licensed and source available, on Chrome and every Chromium browser',
      ],
    },
  },

  // Rows with only `group` render as subheads. `us` is always ours, `them` is always theirs.
  table: [
    { group: 'The shape of it' },
    { label: 'The agent', us: 'Claude Code, Codex or Antigravity, your pick, down to the model', them: 'Claude' },
    { label: 'Where it thinks', us: 'On your machine; the daemon binds to loopback', them: 'In Anthropic’s cloud' },
    { label: 'What it costs', us: 'Nothing beyond the agent subscription you already have', them: 'A paid Claude plan' },
    { label: 'Browsers', us: 'Chrome, Edge, Brave, Arc: any Chromium browser', them: 'Google Chrome only' },
    { label: 'Source', us: 'MIT licensed, source available', them: 'Proprietary' },
    { label: 'Who else can drive', us: 'Any MCP client: Claude Code, Cursor, Zed share one browser', them: 'Claude apps only' },
    { group: 'On the page' },
    { label: 'Read, click, type, submit', us: 'Yes, and anything consequential asks first', them: 'Yes, with vendor safeguards' },
    { label: 'Console and network', us: 'Yes: errors, failed requests and timings, over Chrome’s debugger', them: 'Yes' },
    { label: 'Files', us: 'Both directions, each gated: downloads land sealed, uploads ask first', them: 'Both directions' },
    { label: 'Show it a job once', us: 'Recordings: do it yourself, later say “do it like last time”', them: 'Workflow recording, in the classic panel' },
    { label: 'Site knowledge', us: 'Site maps: it explores any site and keeps notes, intranets included', them: 'Built in for Gmail, Slack, Calendar, Docs and GitHub' },
    { group: 'While you are elsewhere' },
    { label: 'Scheduled jobs', us: 'Kept in the extension; survives the agent, the client and the daemon', them: 'Kept in Claude’s cloud' },
    { label: 'Long jobs', us: 'Background monitors track progress without an agent or a token', them: 'An agent has to keep looking' },
    { label: 'The obvious commands', us: '“Go back” and “open github.com” run locally, in milliseconds', them: 'Every instruction is a model round trip' },
    { label: 'Voice', us: 'Dictate in the panel, press to talk in the popup', them: 'Type' },
    { group: 'Trust' },
    { label: 'Credentials', us: 'Sealed into placeholders; the agent never sees plaintext', them: '1Password integration; declines sensitive entry' },
    { label: 'Approvals', us: 'A declarative policy, every rule tunable, per-site grants', them: 'Ask before acting, or autonomous with fixed safeguards' },
    { label: 'Prompt injection', us: 'Containment: scoped runs, a sealed agent, page text marked untrusted', them: 'Detection: trained classifiers watch for suspicious patterns' },
  ],

  ours: [
    {
      title: 'Bring your own agent',
      body: 'It runs on the CLI you already pay for, and switching between Claude Code, Codex and Antigravity is one click. No second subscription, and no bet on a single vendor.',
    },
    {
      title: 'An MCP server, not just a panel',
      body: 'The daemon speaks MCP over stdio, so Claude Code, Cursor and Zed can take the wheel of the same real, logged-in tab. One browser, shared by every client you use.',
    },
    {
      title: 'The obvious commands cost nothing',
      body: '“Go back” and “open github.com” are scored against a local grammar and run in the browser in milliseconds. No model is woken for what a model adds nothing to.',
    },
    {
      title: 'Monitors that outlive everything',
      body: 'Watching an upload or a deploy runs in the extension itself. It keeps going when the agent finishes or the daemon goes away, and burns no tokens while it waits.',
    },
    {
      title: 'Dark mode with a measurement behind it',
      body: 'It reads what a page paints, scores contrast against WCAG, and rethemes on the page’s own terms rather than inverting everything.',
    },
    {
      title: 'Credentials the agent cannot read',
      body: 'Passwords, keys, tokens and card numbers become sealed placeholders before the agent sees them, and turn back into plaintext only inside the field they are typed into.',
    },
  ],

  theirs: [
    {
      title: 'One click to install',
      body: 'The Chrome Web Store, versus our npx command plus a trip through chrome://extensions. Their funnel is smoother, and we know it.',
    },
    {
      title: 'Reach beyond the browser',
      body: 'Through Claude Desktop it can touch local files and computer control. Browsentic stops at the tab on purpose: the agent it spawns gets browser tools and nothing else.',
    },
    {
      title: 'Injection classifiers',
      body: 'Anthropic runs trained classifiers that watch for suspicious instruction patterns. We do not. Our answer is containment: theirs detects, ours limits the blast radius.',
    },
    {
      title: 'Enterprise administration',
      body: 'Team and Enterprise admins get org-wide allowlists and blocklists. Browsentic has per-site grants on one machine, and nothing fleet-wide.',
    },
  ],

  choose: {
    them: 'Pick Claude in Chrome if you live in claude.ai, want one-click installation, and are happy inside Anthropic’s walls.',
    us: 'Pick Browsentic if you already run an agent CLI, browse in Edge, Brave or Arc, or want the whole thing local, inspectable and MIT licensed.',
    both: 'Nothing stops you running both. They drive different tabs and answer to different masters.',
  },
}

export const QUICKSTART = [
  {
    n: '01',
    title: 'Install both halves with one command',
    body: 'The npm package carries the extension build, so nothing is cloned and nothing is compiled. It writes the extension to ~/browsentic/extension/chrome-mv3, starts the local daemon and prints a pairing code.',
    code: 'npx browsentic setup',
    lang: 'sh',
  },
  {
    n: '02',
    title: 'Load the extension',
    body: 'Open chrome://extensions, turn on Developer mode, press Load unpacked and choose the folder the command printed. Pin Browsentic to the toolbar so the popup is one click away.',
    code: '~/browsentic/extension/chrome-mv3',
    lang: 'path',
  },
  {
    n: '03',
    title: 'Paste the pairing code',
    body: 'Setup already printed one; this command issues a fresh one. It is single use and lives ten minutes. Paste it into the popup and press Connect, and the daemon hands back a session key that survives restarts.',
    code: 'npx browsentic pair',
    lang: 'sh',
  },
  {
    n: '04',
    title: 'Optional: hand the same browser to an MCP client',
    body: 'The side panel already works. If you also live in a terminal, one more command gives your client the same tab, every page capability and three read-only resources.',
    code: 'claude mcp add browsentic -- browsentic mcp',
    lang: 'sh',
  },
]

export const FAQ = [
  {
    q: 'How do I install it?',
    a: 'One command: npx browsentic setup. It installs the extension, starts the local daemon and prints a pairing code. Two steps are left, and both happen inside the browser: load the printed folder at chrome://extensions with Developer mode on, and paste the code into the popup. Later, npx browsentic@latest update refreshes it in place and your browser stays paired.',
  },
  {
    q: 'Do I need an API key?',
    a: 'No. Browsentic runs on the agent CLI login you already have: Claude Code, Codex or Antigravity. There is no API client in the repository and nothing to paste into a settings field. The daemon spawns your CLI locally, as you.',
  },
  {
    q: 'Is this a headless browser?',
    a: 'The opposite. It drives the real tab in front of you: your sessions, your cookies, your extensions, your two-factor state. Nothing is re-authenticated in a throwaway profile.',
  },
  {
    q: 'What stops a random web page from driving my browser?',
    a: 'Two gates. The daemon classifies every WebSocket peer by its handshake Origin, which the browser sets and a page cannot forge, then still requires a pairing token or an origin-bound session key. A page fails the first gate and never reaches the second.',
  },
  {
    q: 'Can I use it from something other than Claude Code?',
    a: 'Yes. The side panel runs on Claude Code, Codex or Antigravity, picked from the popup with one click. The daemon also speaks MCP over stdio, so Cursor, Zed or Claude Desktop drives the same browser: run claude mcp add browsentic -- browsentic mcp, or the equivalent in your client.',
  },
  {
    q: 'Can it automate several tabs at the same time?',
    a: 'Yes. Every tab gets its own conversation, bound to the tab it started in, so a session carries on there while you look at something else. Three work at once by default and eight can be open, raised with maxConcurrentRuns. A tab another conversation has claimed answers TAB_IN_USE.',
  },
  {
    q: 'What can I actually automate with it?',
    a: 'Ordinary browsing work on sites you are already signed in to: negotiating a renewal in a support chat, answering a job application from a resume you attached, taking a cancellation to the step that cannot be undone, redoing Friday’s expense report from a recording. Anything that reaches someone other than you pauses and names itself first.',
  },
  {
    q: 'Can it write its own script for a page?',
    a: 'Yes, once you let it. The Live tool switch starts off, and while it is off the agent is not told the tools exist. Turn it on and it drafts a small toolkit of JavaScript for that page, shown to you in full before a line of it runs. One approval covers every later call into it, bound to the tab and site you approved. An MCP client can neither install one nor call one.',
  },
  {
    q: 'Does it work with WebMCP sites?',
    a: 'Yes. When a site registers tools for agents through WebMCP (document.modelContext), the page snapshot says so, page_listSiteTools returns their schemas, and page_callSiteTool runs one through the site’s own code. Calls are gated like form submits, because the site decides what a tool does. Sites without WebMCP work exactly as before.',
  },
  {
    q: 'Which browsers work?',
    a: 'Chrome, or another Chromium browser such as Edge, Brave or Arc, via Manifest V3. Firefox is not there yet: it refuses unsigned extensions, and the signed build is not ready. You also need Node.js 20 or newer and one agent CLI on your PATH: claude, codex or agy.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. It is MIT licensed and open source. The only cost is whatever your existing agent subscription already costs you.',
  },
  {
    q: 'How do I add a capability?',
    a: 'One module in src/lib/actions/page/ and one line in the registry, which publishes it as an MCP tool at the same time. Four conventions are load-bearing: touch document and window only inside execute(), keep underscores out of action names, describe() every input field, and validate with ActionError inside execute().',
  },
]

/**
 * /live-tools/. The one capability the user builds rather than receives, so the page is
 * shaped as a story with four beats rather than a feature grid: ask, read, keep, run.
 */
export const LIVE_TOOLS = {
  kicker: 'Live tools',
  title: ['Create your own agent tool,', 'for the site you made it on'],
  lede: 'Ask for something the built-in tools cannot do. Read the code the agent writes, keep it, and it becomes a tool of your own that runs by name.',

  steps: [
    {
      n: '01',
      title: 'Ask for the thing no tool does',
      body: 'Flip the Live tool switch and say what you want. Seek a video, read a canvas, archive every row.',
    },
    {
      n: '02',
      title: 'Read what it wrote',
      body: 'The code arrives in the panel in full, never truncated. You approve the source, not a summary of it.',
    },
    {
      n: '03',
      title: 'Keep it',
      body: 'A second after it works, the panel asks whether to keep it. Name it, or take the name it suggests.',
    },
    {
      n: '04',
      title: 'Run it by name',
      body: 'Type a slash on that site and it is there. No agent, no waiting, no asking you again.',
    },
  ],

  anatomy: {
    lede: 'So you find it by remembering the site, not the tool. Three parts, and only the last one is yours to choose.',
    name: ['youtube.com', 'watch', 'darken-page-except-video-player'],
    parts: [
      ['The site', 'Where it was made, and the only place it runs.'],
      ['The kind of page', 'The first part of the path. Every watch page, not one video.'],
      ['What you called it', 'Yours to name. This is the part you type.'],
    ],
  },

  scope: {
    kicker: 'Scope',
    title: 'It offers itself where it belongs, and nowhere else',
    lede: 'A tool made on a watch page knows it is for watch pages. It does not follow you around the site, and it never leaves the host.',
    rows: [
      ['youtube.com/watch?v=anything', true],
      ['youtube.com/watch/live', true],
      ['youtube.com/results', false],
      ['youtube.com', false],
      ['music.youtube.com/watch', false],
    ],
  },

  examples: {
    kicker: 'In practice',
    title: 'The small things a site should have done itself',
    lede: 'Every one of these is a few lines the agent writes once, on a page you use often.',
    items: [
      { name: 'darken-page-except-video-player', body: 'The dark mode the site never shipped, on the one page you watch.', accent: 'magenta' },
      { name: 'collapse-bot-comments', body: 'Fold every automated comment on a pull request so the human ones are left.', accent: 'brand' },
      { name: 'archive-newsletters', body: 'Clear the promotions out of an inbox in one press instead of forty.', accent: 'lime' },
      { name: 'copy-table-as-csv', body: 'Take the table a dashboard will not export and put it on the clipboard.', accent: 'amber' },
    ],
  },

  trust: {
    kicker: 'What stays yours',
    title: 'Your tool, in your browser, and nowhere else',
    items: [
      {
        title: 'The code never leaves the browser',
        body: 'It is kept by the extension. The daemon is told a tool exists and what it does, never how it works.',
      },
      {
        title: 'Nothing runs unread',
        body: 'You saw the source before it ran the first time. Keeping it is what makes later runs free of asking.',
      },
      {
        title: 'No client can reach it',
        body: 'It is not a page tool, so nothing an MCP client can call touches it. The side panel is the only way in.',
      },
      {
        title: 'Gone when you say so',
        body: 'Type slash remove-tools for the list, and a cross beside each. Removing one deletes the code with it.',
      },
    ],
  },
}

/**
 * /webmcp/. The standard is early and mostly unconsumed, so the page sells the
 * position honestly: sites are starting to publish tools for agents, and this
 * browser is already the client that notices and calls them.
 */
export const WEBMCP = {
  kicker: 'WebMCP',
  title: ['When a site offers its own tools,', 'your agent takes them'],
  lede: 'WebMCP lets a website register tools for agents: add to cart, search flights, file a ticket. Browsentic notices them, hands your agent the schemas, and calls them through the site’s own code.',

  standard: {
    kicker: 'The standard',
    title: 'A site’s API for agents, served on the page itself',
    lede: 'WebMCP is a W3C proposal shipping natively in Chrome: a page registers tools on document.modelContext, each with a name, a description, an input schema and a handler the site wrote.',
    items: [
      {
        title: 'The site declares what it can do',
        body: 'Instead of an agent guessing at buttons, the site names its own verbs: what each tool does, what it takes, what it returns.',
        accent: 'brand',
      },
      {
        title: 'The site’s code does the work',
        body: 'A registered handler runs the same logic the UI runs, so a call cannot miss a selector or catch the page mid-render.',
        accent: 'ember',
      },
      {
        title: 'One call, not a click sequence',
        body: 'Add to cart becomes one schema-checked call rather than find, scroll, click, wait, verify. Fewer steps, fewer ways to be wrong.',
        accent: 'lime',
      },
    ],
  },

  flow: {
    kicker: 'How Browsentic uses it',
    title: 'Noticed on arrival, called on approval',
    steps: [
      {
        n: '01',
        title: 'The snapshot says so',
        body: 'The page snapshot carries a siteTools list whenever a page registers any. The agent learns a site is agent-ready without being told.',
      },
      {
        n: '02',
        title: 'The schemas come over',
        body: 'page_listSiteTools returns every tool the site registered: name, description and input schema, ready to call.',
      },
      {
        n: '03',
        title: 'The site takes the call',
        body: 'page_callSiteTool runs one by name, through the site’s own handler, and returns whatever it produced.',
      },
      {
        n: '04',
        title: 'You are asked first',
        body: 'A site tool call is gated like a form submit: the site decides what it does, so it pauses in the panel and names itself.',
      },
    ],
  },

  coverage: {
    kicker: 'Coverage',
    title: 'Native, aliased or polyfilled, it all answers',
    lede: 'The reader goes to the page’s main world, so it finds whichever implementation a site actually has.',
    rows: [
      ['document.modelContext, native in Chrome', true],
      ['navigator.modelContext, the older alias', true],
      ['Library and polyfill implementations', true],
      ['Sites that register nothing', false],
    ],
    note: 'The last row is most of the web today, and nothing changes there: the ordinary page tools carry the job, and the agent is told not to go looking.',
  },

  trust: {
    kicker: 'Kept honest',
    title: 'A new door, watched like the old ones',
    items: [
      {
        title: 'Calls are gated like submits',
        body: 'The site-tool-call rule pauses every call in the side panel first. The site decides what a tool does, which is exactly why you are asked.',
      },
      {
        title: 'Listing is read-only',
        body: 'Discovering tools and reading schemas changes nothing on the page, so autonomous site maps record which pages are agent-ready without acting on them.',
      },
      {
        title: 'No install, no debugger, no flags',
        body: 'Reading a page’s registered tools uses the extension’s ordinary scripting permission. Nothing is injected for you to approve, and no debugger bar appears.',
      },
      {
        title: 'Headless callers stay held',
        body: 'An MCP client has nobody to answer a prompt, so its calls resolve by the unattended policy, which ships as deny until you say otherwise.',
      },
    ],
  },
}

export const NAV_LINKS = [
  { href: '#how', label: 'Architecture' },
  { href: '#highlights', label: 'What it does' },
  { href: '#security', label: 'Security' },
  { href: '#start', label: 'Quickstart' },
]
