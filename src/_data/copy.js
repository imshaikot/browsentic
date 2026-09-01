// The single source of every fact on the site. Sourced from the repository README
// and docs/. Templates hold no copy of their own.

export const REPO = 'https://github.com/imshaikot/browsentic'
export const VERSION = 'v0.4.8'

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
    'A browser extension plus a local daemon that hands your real, logged-in browser tab to the AI agent CLI you already run, by voice, by typing, or by replaying a session you recorded once. It also speaks MCP, so an external client can drive the same browser.',
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
  ],
}

export const HERO = {
  badge: 'Open source, MIT licensed. It runs on the agent you already pay for: Claude Code, Codex or Antigravity.',
  title: { lead: 'No new browser. No API key.', tail: 'Your tabs, ', accent: 'your own AI agent' },
  lede: 'Like Claude Code for your browser, except it can see the page. Say what you want in the side panel and the agent you already run drives the tab in front of you, inside the session you are already signed in to. It shows its work, asks before anything consequential, and nothing leaves your machine.',
  voice: 'or open the side panel and speak it aloud',
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
    body: 'A side panel in Chrome or any Chromium browser. Speak to it, type at it, or press record and show it a job once, and it works the tab in front of you inside the session you are already signed in to. This is Browsentic.',
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
    { tool: 'page_getPageInfo', detail: 'snapshot · 41 interactive elements', kind: 'agent', ms: 1100 },
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
    lede: 'No relay, no hosted runner, no browser in someone else’s data centre. The extension dials out to a daemon on loopback, because a Manifest V3 service worker cannot listen for connections. One daemon owns the browser link, so several MCP clients can share one browser.',
  },
  capabilities: {
    kicker: 'Capabilities',
    title: ['Sense the page, act on it,', 'and wait out the slow parts'],
    lede: 'Perceiving the page as structure rather than pixels: a layout diagram, stable selectors, rendered text, screenshots. Listening while you talk it through. Sensing progress and waiting out an upload or a deploy so you never have to hover over it, or working to a clock when the page offers nothing to watch. Then acting with a human hand, and remembering enough to run the whole thing again unprompted. Aim by CSS selector, visible text, ARIA role or index, because visible text outlives the redesigns that break selectors. Or hand it the lens and point at the thing yourself.',
  },
  orchestrate: {
    kicker: 'Agent orchestration',
    title: ['Several tabs, several agents,', 'one browser, all at once'],
    lede: 'A conversation belongs to the tab it started in, not to whatever you happen to be looking at. Start one where an upload is running, another where support is waiting on an answer, a third watching a release, then go and read something else. The extension holds each session in its own tab and dials out to a single local daemon, which wakes one agent per session and streams the work back to the panel as it happens.',
  },
  automations: {
    kicker: 'In practice',
    title: ['Jobs people actually hand over,', 'and where each one stops for you'],
    lede: 'Ordinary browsing work, in sites you are already signed in to: the negotiation, the application, the cancellation, the thing you redo every Friday. The agent senses what is in front of it, works out what the job needs and sees it through. Anything that commits something, or sends it to someone other than you, pauses first and names itself before it happens.',
  },
  teach: {
    kicker: 'Skills',
    title: ['Map any web app automatically,', 'then keep it as your own skill'],
    lede: 'Turn it loose on a site and it maps itself. It reads robots.txt and the sitemap, explores, screenshots, writes down what it worked out, then hands you a skill to read before you arm it. Walk it through a job once and that becomes a skill of your own. And the obvious commands never bother a model at all.',
  },
  panel: {
    kicker: 'The extension',
    title: ['Everything happens in the side panel', 'of the browser you already have open'],
    lede: 'Install it, pair it once, and the panel opens beside whatever tab you are on. Speak to it, type at it, or press record and show it a job once. It reads the page you are actually looking at, asks before anything commits, and keeps every conversation in the tab it started in.',
  },
  mcp: {
    kicker: 'Optional integration',
    title: ['The browser MCP server, for when', 'you already live in a terminal'],
    lede: 'The extension is the product and the side panel needs none of this. But the daemon also speaks MCP, so Claude Code, Codex, Antigravity, Cursor or Zed can take the wheel of the same real tab. Headless automation wakes up with amnesia, no session, no cookies, no two-factor state, and a login wall between it and anything worth doing. Browsentic inherits the tab you are already signed into.',
  },
  highlights: {
    kicker: 'What it does',
    title: ['What handing over a tab', 'actually gets you'],
    lede: 'Everything below ships in the extension, works on the sites you are already signed in to, and stops for your approval at anything consequential.',
  },
  security: {
    kicker: 'Security model',
    title: 'An agent driving your real browser has to earn it',
    lede: 'Everything below is a property of how it is built, not a promise in a policy document. It is a local daemon, an extension that dials out to it, and no third party in between.',
  },
  start: {
    kicker: 'Quickstart',
    title: 'One command, then two things only you can do',
    lede: 'You need Chrome or another Chromium browser, Node.js 20 or newer, and one agent CLI on your PATH: claude, codex or agy. The npm package carries the extension build, so there is nothing to clone and nothing to compile.',
  },
  faq: {
    kicker: 'FAQ',
    title: 'The ones people ask first',
  },
  compare: {
    kicker: 'Comparison',
    title: ['Claude in Chrome extends Claude.', 'Browsentic extends your browser.'],
    lede: 'Anthropic ships an extension that puts Claude in a Chrome side panel. Browsentic starts from the other end: the browser you already use, handed to whichever agent you already run. Same idea, different owner. Here is the honest version of where they overlap, where each one wins, and how to pick.',
  },
}

export const CTA = {
  title: { lead: 'Stop describing the page.', accent: 'Hand it over.' },
  lede: 'Free and MIT licensed. Nothing to sign up for, no key to paste, and a fresh install connects to nothing until you redeem a pairing code yourself.',
  command: 'npx browsentic setup',
}

/** What the side panel actually is, in the space the integration cards used to hold. */
export const PANEL_POINTS = [
  {
    id: 'input',
    title: 'Speak it, type it, or show it once',
    body: 'Dictate hands-free in the side panel, hold to talk in the popup, or just type. Work a tedious job through yourself with the recorder on and it keeps every step as a skill of your own.',
  },
  {
    id: 'sessions',
    title: 'A session per tab, working in the background',
    body: 'The conversation belongs to the tab it started in and carries on there while you read something else. A pulsing dot on the toolbar icon and on the tab favicon marks whatever is still at work.',
  },
  {
    id: 'approvals',
    title: 'Approvals surface where you are looking',
    body: 'Anything that commits something, or sends it to someone other than you, pauses in the panel and names itself first. Cancelling a run stops it mid-flight.',
  },
  {
    id: 'agent',
    title: 'Your agent, switched with one click',
    body: 'The panel runs on Claude Code, Codex or Antigravity, picked from the popup, down to which model each one runs. No key to paste, because it spawns the CLI you already signed in to, as you.',
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
    body: 'A module under src/lib/actions/page/ plus one line in the registry, and it publishes as an MCP tool at the same time. No second place to remember.',
  },
]

export const STATS = [
  { value: 49, suffix: '', label: 'browser capabilities', note: 'sense, act, navigate, wait' },
  { value: 3, suffix: '', label: 'tabs worked at once', note: 'independent sessions, up to eight' },
  { value: 0, suffix: '', label: 'API keys to configure', note: 'it runs on the login you already own' },
  { value: 1, suffix: '', label: 'command to install', note: 'npx browsentic setup, MIT licensed' },
]

export const TOOL_GROUPS = [
  {
    id: 'read',
    label: 'Read',
    accent: 'brand',
    blurb:
      'Takes in the page as structure rather than pixels: a snapshot carrying a layout diagram and stable selectors, rendered text, patient waiting for an element to appear or vanish, the search control wherever a site hid it, a capture of the whole tab or one element, the palette and luminance a page actually paints, a WCAG contrast score, and the captcha hiding inside a closed shadow root. When it cannot name the thing you mean, it hands you the lens and you point at it.',
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
    id: 'script',
    label: 'Script',
    accent: 'magenta',
    blurb:
      'Writes its own tool when the fixed set is the wrong shape. A job that repeats twenty times with only the input changing, or something no tool covers (seeking a video, reading a canvas, driving an editor’s own API), becomes a small script the agent drafts for that page. You read the source in the side panel and approve it before a line of it runs, and every later call reuses what you approved without asking again. Off until you turn the Live tool switch on, bound to the tab and site you approved it for, and never available to an MCP client.',
    tools: ['page_injectCode', 'page_runCode'],
  },
  {
    id: 'move',
    label: 'Navigate',
    accent: 'magenta',
    blurb:
      'Finds its own way around. Opening a URL, retracing back and forward, reloading, searching a site on its own terms rather than guessing at query strings, scrolling to whatever matters, spawning a tab, surveying the ones you already have open, closing the ones it is finished with.',
    tools: ['page_navigate', 'page_searchSite', 'page_scrollTo', 'page_openTab', 'page_switchTab', 'page_closeTab'],
  },
  {
    id: 'wait',
    label: 'Wait',
    accent: 'lime',
    blurb:
      'Senses the progress signals a page gives off, then keeps watch in the background while an upload, a build or a deploy runs its course: the tab stays pinned, percent and ETA are tracked, and an MCP client can long-poll until it lands. When a page offers nothing to watch, it works to a clock instead, waking itself in ten minutes or every two to redo the check and tell you only what changed.',
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
      'Reads what the page reports rather than what it shows: console messages, uncaught exceptions, failed requests and their timings, captured over Chrome’s debugger while a diagnostics session is open. Open one, act, read what actually broke, close it. The difference between “the button did nothing” and “the POST behind it returned a 500”.',
    tools: ['page_startDiagnostics', 'page_readConsole', 'page_readNetwork', 'page_stopDiagnostics'],
  },
  {
    id: 'files',
    label: 'Files',
    accent: 'amber',
    blurb:
      'Moves files in both directions. Hands one you attached to a file input on the page, and captures the file a click produces, sealed on disk with notes the agent can read, ready to upload somewhere else.',
    tools: ['page_listFiles', 'page_attachFile', 'page_captureDownload', 'page_listDownloads'],
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
    sub: 'Manifest V3, Chrome and Chromium',
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
    body: 'Reasons locally, spawned against the login you already have. Claude Code, Codex or Antigravity, switched with one click, each on the model you pick. No API client in the repository, no key to configure, no third-party relay.',
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
      '62 percent, about a minute to go',
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
    sub: '3 of 3 slots in use',
    body: 'Woken as you, on the CLI you already signed in to, and told about this session and no other.',
  },
}

export const ORCHESTRATION_POINTS = [
  [
    'A session belongs to its tab, not to your attention',
    'The conversation is bound to the tab it started in. It carries on there while you look at something else, its work stays in that tab instead of following you, and reaching into a tab it was never pointed at is a gated action.',
  ],
  [
    'Two sessions never share a tab',
    'A tab another conversation has claimed answers TAB_IN_USE. Tabs a session opens for itself join that same session as subtabs, so everything it did stays in one transcript.',
  ],
  [
    'Three at a time, eight open',
    'Three sessions work at once by default and eight can be open, so the fourth holds for a slot instead of crowding the browser. Raise maxConcurrentRuns as far as eight.',
  ],
  [
    'Stopping one leaves the rest alone',
    'End the session you are looking at and the others carry on. Close a tab and only that one ends, with its transcript moved to History. A pulsing dot on the toolbar icon and on the tab’s own favicon marks whatever is still at work.',
  ],
]

export const ORCHESTRATION_SHARED = {
  chip: 'shared link',
  body: 'The same link carries anything else you point at it. Claude Code in one terminal, Codex in another, Cursor or Zed alongside them: they all reach the browser you are already signed into, and every step they take surfaces on the timeline marked external.',
}

export const AUTOMATION_FEATURED = {
  kicker: 'Worked example',
  title: 'Find the job, then apply as you',
  body: 'Attach your resume once. Browsentic takes it in there and then and keeps notes on it, so the agent knows what it is offering without ever seeing your filesystem. From then on it senses the posting in front of it, weighs it against what you have actually done, answers the application in your own words, and hands over the file the form is asking for. Both of the steps that reach the employer stop and name themselves first.',
  result: 'Submitted · 1 of 6 postings on this board',
  gates: ['file-upload · page_attachFile', 'form-submission · page_submitForm'],
  steps: [
    { tool: 'page_listFiles', note: 'resume.pdf · read once, at attach time', ms: 1500 },
    { tool: 'page_getPageInfo', note: 'application form · 22 fields, 3 required', ms: 1600 },
    { tool: 'page_fillInput', note: 'experience · matched to your resume', ms: 1800 },
    { tool: 'page_attachFile', note: 'resume.pdf, where the form asks for it', ms: 2400, gate: true },
    { tool: 'page_submitForm', note: 'the step that reaches the employer', ms: 2600, gate: true },
  ],
}

export const AUTOMATIONS = [
  {
    id: 'support',
    title: 'Negotiate, in the chat you are already signed into',
    body: 'Your account, your ticket history, last year’s invoice open in the next tab. It takes in what support actually said, weighs it against what you paid before, drafts the counteroffer in your own words, and holds right at the moment it would reach them.',
    accent: 'ember',
    tools: ['page_extractText', 'page_typeText', 'page_submitForm'],
    gate: 'Pauses at Send, under the form-submission rule',
  },
  {
    id: 'cancel',
    title: 'Cancel the things you stopped using',
    body: 'Point it at a billing page and it works out where the cancellation actually lives, sees the retention offer for what it is, answers the exit survey and comes to a halt in front of the one step that cannot be undone. The consequence is the last step, so that is the step you keep for yourself.',
    accent: 'magenta',
    tools: ['page_getPageInfo', 'page_clickElement', 'page_extractText'],
    gate: 'Name page_clickElement in requireApproval and the final step asks first',
  },
  {
    id: 'watch',
    title: 'Sit through the slow part so you do not have to',
    body: 'Start the upload, the build or the export, then hand the tab over. It senses the progress a page gives off, keeps percent and ETA in view from the background, and tells you the moment it lands. Nobody has to sit watching a bar that moves once a minute.',
    accent: 'lime',
    tools: ['page_startMonitor', 'page_awaitMonitor', 'page_monitorStatus'],
    gate: 'Nothing to approve. It is only watching',
  },
  {
    id: 'repeat',
    title: 'Do Friday’s expense report like last time',
    body: 'Show it once, with the recorder on. Browsentic keeps ordered steps named after what you accomplished, and whatever you typed comes back as a placeholder it asks you for. Next Friday the whole instruction is “do it like last time”.',
    accent: 'amber',
    tools: ['page_listRecordings', 'page_readRecording', 'page_fillInput'],
    gate: 'Replay is a plan, not a script. A step that no longer lands halts the run',
  },
  {
    id: 'digest',
    title: 'Pull the week out of five dashboards',
    body: 'Five tools you are logged into, one summary. It takes each one in as rendered text, the way it appears to you, rather than scraping markup full of hidden nodes and off-screen strings that never met your eyes.',
    accent: 'brand',
    tools: ['page_extractText', 'page_screenshot', 'page_openTab'],
    gate: 'Raw HTML reads are denied by default, hidden text with them',
  },
  {
    id: 'bulk',
    title: 'Work a list, one record at a time',
    body: 'The same twelve fields across forty rows: the job nobody schedules and everybody postpones. It works each record through, checks what came back against what it expected, and moves on, stopping the moment a page stops resembling the one before it.',
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
]

/** The home page highlights: six outcomes in the launch voice, each owning a deep page. */
export const HIGHLIGHTS = [
  {
    id: 'record',
    title: 'Show it a job once and it remembers',
    body: 'Press record, work through the job yourself, press stop. From then on “do it like last time” is the whole instruction. Replay is a plan, not a script: every step is re-checked against the live page before it acts.',
    accent: 'amber',
    link: { href: '/skills/', label: 'Record and replay' },
  },
  {
    id: 'maps',
    title: 'It learns a site before it works it',
    body: 'Point it at a site and it explores on its own: reads the sitemap, walks the pages, screenshots as it goes, then writes itself notes. Every later session on that domain already knows its way around.',
    accent: 'lime',
    link: { href: '/skills/', label: 'Automated site maps' },
  },
  {
    id: 'orchestrate',
    title: 'Several tabs, several agents, one browser',
    body: 'Each tab holds its own conversation and carries on while you read something else. Three sessions work at once by default, up to eight, and stopping one leaves the rest alone.',
    accent: 'magenta',
    link: { href: '/orchestration/', label: 'Orchestration' },
  },
  {
    id: 'lens',
    title: 'Point at what you mean',
    body: 'Press the lens and click the element you are talking about, and it rides along with your next message. When words are not enough, the agent hands the lens back and asks you to point.',
    accent: 'brand',
    link: { href: '/capabilities/', label: 'Targeting and the lens' },
  },
  {
    id: 'captcha',
    title: 'It does not stall at “verify you are human”',
    body: 'It recognises the widget, ticks the checkbox with a real browser-level click once you approve, and hands anything that needs a person straight to you instead of failing in silence.',
    accent: 'ember',
    link: { href: '/capabilities/', label: 'What it can read' },
  },
  {
    id: 'live',
    title: 'When a job repeats twenty times, it writes a tool',
    body: 'Twenty tags to create, every row to archive, a video to seek, a canvas to read. Flip the Live tool switch and the agent drafts a small script for that page, you read the code in the panel and approve it, then it runs as many times as the job needs. Off until you turn it on, and nothing runs unread.',
    accent: 'magenta',
    link: { href: '/capabilities/', label: 'Live tools' },
  },
  {
    id: 'skills',
    title: 'Teach it your own moves',
    body: 'Write a skill in plain markdown and drop it in, or let a mapped site or a recording become one. Skills route by trigger words, and nothing arms itself until you have read it.',
    accent: 'brand-deep',
    link: { href: '/skills/', label: 'Skills' },
  },
]

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
    title: 'Agent-written code is read before it runs',
    body: 'The Live tool switch starts off, and with it off the agent is not even told the tools exist. Turned on, any script it writes arrives as an approval prompt with a Review button that shows you the full source first. What you approve is that code, on that tab and that site, so later calls can only reuse what you already read. There is no "always allow" for it, and an MCP client can neither install a script nor call one you approved.',
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
    { label: 'Console and network', us: 'Yes: errors, failed requests and timings, read over Chrome’s debugger', them: 'Yes' },
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
      body: 'It runs on the CLI you already pay for and are already signed in to, and switching between Claude Code, Codex and Antigravity is one click in the popup. No second subscription, and no bet on a single vendor.',
    },
    {
      title: 'An MCP server, not just a panel',
      body: 'The daemon speaks MCP over stdio, so Claude Code, Cursor and Zed can take the wheel of the same real, logged-in tab. One browser, shared by every client you use.',
    },
    {
      title: 'The obvious commands cost nothing',
      body: '“Go back”, “scroll to the top” and “open github.com” are scored against a local grammar first and run in the browser in milliseconds. No model is woken for the things a model adds nothing to.',
    },
    {
      title: 'Monitors that outlive everything',
      body: 'Watching an upload or a deploy runs in the extension itself. It keeps going when the agent finishes, the MCP client disconnects, or the daemon goes away, and it burns no tokens while it waits.',
    },
    {
      title: 'Dark mode with a measurement behind it',
      body: 'It reads what a page paints, scores contrast against WCAG, and rethemes on the page’s own terms, preferring the dark hook the site already defines over inverting everything.',
    },
    {
      title: 'Credentials the agent cannot read',
      body: 'A deterministic sanitizer runs on both sides of the socket. Passwords, keys, tokens and card numbers become sealed placeholders before the agent sees them, and turn back into plaintext only inside the field they are typed into.',
    },
  ],

  theirs: [
    {
      title: 'One click to install',
      body: 'The Chrome Web Store, versus our npx command plus a trip through chrome://extensions. Their funnel is genuinely smoother, and we know it.',
    },
    {
      title: 'Reach beyond the browser',
      body: 'Through Claude Desktop it can touch local files and computer control. Browsentic deliberately stops at the tab: the spawned agent gets browser tools and nothing else.',
    },
    {
      title: 'Injection classifiers',
      body: 'Anthropic runs trained classifiers that watch for suspicious instruction patterns. We do not. Our answer is containment: scoped runs, a sealed agent, page text marked untrusted. Both are partial; theirs detects, ours limits the blast radius.',
    },
    {
      title: 'Enterprise administration',
      body: 'Team and Enterprise admins get org-wide allowlists and blocklists. Browsentic has per-site grants on one machine, and nothing fleet-wide.',
    },
  ],

  choose: {
    them: 'Pick Claude in Chrome if you live in claude.ai, want one-click installation, and are happy inside Anthropic’s walls. It is a polished product with real safety work behind it.',
    us: 'Pick Browsentic if you already run an agent CLI, want the same browser reachable from your terminal and your editor, browse in Edge, Brave or Arc, or want the whole thing local, inspectable and MIT licensed.',
    both: 'Nothing stops you running both. They drive different tabs and answer to different masters.',
  },
}

export const QUICKSTART = [
  {
    n: '01',
    title: 'Install both halves with one command',
    body: 'The npm package carries the extension build, so nothing is cloned, nothing is compiled, and nothing is downloaded beyond the one package. It writes the extension to ~/browsentic/extension/chrome-mv3, starts the local daemon and prints a pairing code.',
    code: 'npx browsentic setup',
    lang: 'sh',
  },
  {
    n: '02',
    title: 'Load the extension',
    body: 'Open chrome://extensions, turn on Developer mode, press Load unpacked and choose the folder the command printed. On macOS you can press Shift Command G in the picker and paste the path. Pin Browsentic to the toolbar so the popup is one click away.',
    code: '~/browsentic/extension/chrome-mv3',
    lang: 'path',
  },
  {
    n: '03',
    title: 'Paste the pairing code',
    body: 'Setup already printed a code. It is single use and lives for ten minutes, and the command here issues a fresh one if it expired. Paste it into the popup and press Connect. The daemon then hands back a long-lived session key that survives browser and daemon restarts, and dies only when you revoke it.',
    code: 'npx browsentic pair',
    lang: 'sh',
  },
  {
    n: '04',
    title: 'Optional: hand the same browser to an MCP client',
    body: 'The side panel already works at this point. If you also live in a terminal, one more command gives your client the same tab, with every page capability plus browsentic_status and three read-only resources.',
    code: 'claude mcp add browsentic -- browsentic mcp',
    lang: 'sh',
  },
]

export const FAQ = [
  {
    q: 'How do I install it?',
    a: 'One command: npx browsentic setup. It installs the extension to ~/browsentic/extension/chrome-mv3, starts the local daemon and prints a pairing code, with Node.js 20 or newer as the only prerequisite. Two steps are left and both happen inside the browser, so only you can do them: load that folder at chrome://extensions with Developer mode on, and paste the code into the popup. Later, npx browsentic@latest update refreshes the extension in place. The install path never changes, so your browser stays paired.',
  },
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
    a: 'Yes. The side panel itself is switchable: it runs on Claude Code, Codex or Antigravity, picked from the popup with one click, and for most people that is the whole answer. Beyond the panel the daemon also speaks MCP over stdio, so an external client drives the same browser: Cursor, Zed, Claude Desktop. Run claude mcp add browsentic -- browsentic mcp, or the equivalent in your client. Tool definitions are generated from the same registry the extension ships, so they cannot drift from what the browser can actually do.',
  },
  {
    q: 'Can it automate several tabs at the same time?',
    a: 'Yes. Every tab gets its own conversation, bound to the tab it started in, so a session carries on there while you look at something else instead of following whichever tab is in front. Eight sessions can be open and three work at once by default, raised as far as eight with maxConcurrentRuns. A fourth holds for a slot, ending one leaves the rest alone, and a tab another conversation has claimed answers TAB_IN_USE.',
  },
  {
    q: 'What can I actually automate with it?',
    a: 'Ordinary browsing work on sites you are already signed in to: negotiating a renewal in a support chat that already holds your ticket history, answering a job application from a resume you attached, taking a cancellation as far as the step that cannot be undone, watching a slow release and saying when it lands, redoing Friday’s expense report from a recording, or pulling one summary out of five dashboards. Anything that commits something, or sends it to someone other than you, pauses and names itself before it happens.',
  },
  {
    q: 'Can it write its own script for a page?',
    a: 'Yes, once you let it. The composer has a Live tool switch that starts off, and while it is off the agent cannot reach the tools and is not told they exist. Turn it on and, for a job that repeats many times with only the input changing or for something no built-in tool covers, the agent drafts a small toolkit of JavaScript functions for that page. It arrives as an approval prompt with a Review button that shows the full source, and nothing runs until you allow it. One approval then covers every later call into that toolkit, which is what turns twenty repetitions into twenty cheap calls, and it is bound to the tab and site you approved it for. A different script asks again, there is no "always allow" for it, and an MCP client can neither install one nor call one you approved from the panel.',
  },
  {
    q: 'Which browsers work?',
    a: 'Chrome, or another Chromium browser such as Edge, Brave or Arc, via Manifest V3. Firefox is not there yet: release Firefox refuses unsigned extensions, and an add-on loaded through about:debugging is discarded on restart, so a signed build distributed through addons.mozilla.org is the fix and it is not ready. Developer Edition and Nightly can load a Firefox build from a source checkout. You will need Node.js 20 or newer, and one agent CLI on your PATH: claude, codex or agy.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. It is MIT licensed and open source. The only cost is whatever your existing agent subscription already costs you.',
  },
  {
    q: 'How do I add a capability?',
    a: 'One module in src/lib/actions/page/ and one line in the registry, which publishes it as an MCP tool at the same time. That is the whole of creating your own browsing action. Four conventions in an action module are load-bearing at runtime: touch document and window only inside execute(), keep underscores out of action names, describe() every input field, and validate with ActionError inside execute() rather than a zod refine or transform.',
  },
]

export const NAV_LINKS = [
  { href: '#how', label: 'Architecture' },
  { href: '#highlights', label: 'What it does' },
  { href: '#security', label: 'Security' },
  { href: '#start', label: 'Quickstart' },
]
