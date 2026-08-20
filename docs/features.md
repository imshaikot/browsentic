# Features

What Browsentic can do, and when each part is the right tool.

Browsentic hands your real, logged-in browser to the AI agent you already run. Say what you want and
it drives the page; ask a question and it reads the page and answers. Everything it does shows up on
a live timeline, and anything consequential waits for your approval first.

---

## Two ways to drive

| | Side panel | MCP client |
| --- | --- | --- |
| You talk to | Browsentic, by voice or typing | Claude Code, Codex, Gemini CLI, Cursor, … |
| Agent | Claude Code, Codex or Antigravity, spawned locally by the daemon | Whichever client you registered |
| Skills and site notes | Routed and applied automatically | Not applied |
| Approval prompts | Yes | Your client's own permissions |
| Recording, site mapping | Full access | Read-only |

Both land on the same browser through the same daemon, so you can move between them mid-task.

---

## Voice and text

Dictate hands-free in the side panel, press-to-talk in the popup, or just type. Speech uses the
browser's built-in recognition — nothing is bundled or downloaded. In Chrome that means audio is
streamed to Google for transcription; type instead if that matters to you.

Replies stream back token by token. Follow-ups continue the same conversation, so **"now click the
second one"** works. Conversations are saved, named automatically, and reopenable from the panel's
history.

---

## Page capabilities

29 actions, published to MCP clients as 29 tools generated from the same registry the extension
ships — so a tool can never describe something the browser cannot do.

### Reading

| Tool | What it does |
| --- | --- |
| `page_getPageInfo` | The workhorse. Document metadata, viewport and scroll state, a semantic layout tree with a text diagram, the heading outline, and an inventory of links, buttons, fields and forms — **each with a stable selector already computed**, plus its ARIA role, its live state (disabled, checked, expanded, filled, `aria-current`) and the landmark region it sits in. |
| `page_extractText` | Rendered text, or raw HTML, of an element or the whole page. |
| `page_waitForElement` | Wait until an element is attached, visible, hidden or detached. |
| `page_screenshot` | The current viewport, the full scroll view, or one element. Written to disk only when asked. |
| `page_findProgress` | Scan for progress signals worth monitoring — bars, percent readouts, spinners — each with a selector. |

Start with `getPageInfo` and use the selectors it hands back rather than guessing. Better still,
target by **visible text** — it survives redesigns that break CSS paths.

### Acting

| Tool | What it does |
| --- | --- |
| `page_clickElement` | Clicks like a user, firing the full pointer and mouse sequence. |
| `page_trustedClick` | A real browser-level click — `isTrusted` is true, dispatched through Chrome’s debugger rather than from the page. The pointer travels to the target and dwells before pressing, so widgets that sample pointer movement get the sequence they wait for. Takes a raw viewport point as well as an element. For the handful of pages that reject synthetic clicks, and the browser features that only a genuine gesture unlocks. |
| `page_findCaptcha` | Identify the captcha behind a "verify you are human" block — Turnstile, reCAPTCHA, hCaptcha, GeeTest, Arkose, AWS WAF — reading through the closed shadow roots and cross-origin frames vendors hide it in. Read-only. |
| `page_solveCaptcha` | Tick the widget's checkbox with a real click and wait for the verdict. Confirm-gated. An image challenge is handed back to you to answer, never attempted. |
| `page_hoverElement` | Triggers menus, tooltips and hover states. |
| `page_focusInput` | Focus and place the caret, or select all. |
| `page_fillInput` | Set a value in an input, textarea or contenteditable. |
| `page_typeText` | Streams text one keystroke at a time at a human pace — a real key event per character, varying pauses, longer breaths after punctuation. For pages that *watch* you type. |
| `page_selectOption` | Choose a `<select>` option by value, label or position. |
| `page_selectText` | Select text by element or exact phrase. |
| `page_pressKey` | A key press with optional modifiers. |
| `page_submitForm` | Submit a form, firing its validation as if you pressed Enter. |
| `page_highlightElement` | A temporary outline overlay with an optional caption — for showing you what it found. |

### Moving

| Tool | What it does |
| --- | --- |
| `page_navigate` | Go to a URL, or back / forward / reload. |
| `page_scrollTo` | To an element, an absolute position, or by one viewport. |
| `page_openTab` | Open a URL in a new tab, which becomes the target for later actions unless `active: false`. |
| `page_switchTab` | Bring another tab to the front. With no arguments it *lists* the open tabs and their ids. |
| `page_closeTab` | Close a tab and report which one the browser moved to. |

Tab tools are the only ones that change *which* tab everything else acts on, and they are scoped to
the current window. `closeTab` refuses deliberately in four cases: the only tab in a window, a
pinned tab, a browser page, and a tab being recorded.

### Files

`page_listFiles` and `page_attachFile` let the agent put a file you have stored in Browsentic into
a file input on the page. Files are summarised by a one-shot local read when you attach them, so the
agent knows what it is uploading without being able to open your filesystem.

### Recordings

`page_listRecordings` and `page_readRecording` read back the browsing sessions you recorded — see
[Recordings](#recordings-show-it-once-repeat-it-later).

Most capabilities take a target described by **CSS selector, visible text, ARIA role or index**.

---

## Instant commands

Sending "go back" out to a language model costs a round trip and several seconds to arrive at
something the extension could have done immediately. So every instruction is scored against a local
grammar first. Confident single-step commands run in the browser in milliseconds and stop there,
marked with a ⚡ on the timeline. Everything else goes to the agent with the text untouched.

| Runs locally | Goes to the agent |
| --- | --- |
| back, forward, reload | "is there a login button?" |
| open github.com, open localhost:3000 | "open the settings menu" |
| open github.com in a new tab | "close this tab", "switch to my gmail tab" |
| google something, search the web for something | "search for wireless headphones" |
| scroll up, down, top, bottom, page down | "scroll down and tell me what it says" |
| press enter, hit escape, press arrow down | "click sign in and then fill in my email" |
| click Sign in, tap Continue | "click Buy now", "click it" |
| record my browsing session, stop recording | "record a video of this page" |
| stop monitoring | "stop watching and tell me what happened" |

The bias is toward escalating, because the two mistakes are not symmetric. Escalating something it
could have handled costs a round trip. Acting on something it misread spends a wrong click on your
real page. Questions, multi-step asks, conditionals, vague targets and consequential clicks all
escalate — as does any local command that runs and fails.

Local commands never reach the daemon, so they leave no trace in `browsentic-mcp logs`. That is
expected, not a bug. Explain any single routing decision with:

```sh
yarn check:intent "take me to the checkout page"
```

---

## Background monitoring

Long jobs — an upload, a build, a deploy — do not need an agent sitting on them burning tokens on
"is it done yet".

Ask Browsentic to watch, and it finds the progress signal (`page_findProgress`), pins the tab, and
watches it in the background while you work elsewhere. It tracks percent, extrapolates an ETA from
the sample history, notices when progress has stalled, and notifies you on completion.

```
watch this upload and tell me when it's done
```

| | |
| --- | --- |
| Completion conditions | An element appears or vanishes, page text or tab title matches a regex, a progress bar reaches a threshold |
| Concurrent monitors | 3 |
| Default / maximum duration | 30 minutes / 4 hours |
| While it runs | The tab is pinned; you can work anywhere else |
| On completion | A browser notification, plus the run's own report |

An MCP client can also block on one with `page_awaitMonitor`, which long-polls: `settled: false`
just means the poll window passed while the watch continues, so call again. The monitor keeps
running in the browser even if the client disconnects.

`stop monitoring` ends one without waking the agent at all.

---

## Site maps: teach it a site once

An agent that has never seen your site spends its first minutes rediscovering it — where search
lives, what a button is really called, why the list looks empty until you scroll. Site maps do that
exploration once and keep the result.

Press **Map this site** in the side panel’s **Skills** tab, or say:

```
@site-mapper map this site
```

Browsentic reads the site's own `robots.txt` and `sitemap.xml`, looks up public background on the
domain, then walks the site for a few minutes taking screenshots. The result is a set of notes
scoped to that domain:

```
~/browsentic/skills/acme-com/
├── SKILL.md          landmarks, key pages, how they connect, quirks
├── map.json          the structured report behind it
├── screenshots/      captures taken during the crawl
├── evidence/         the robots.txt and sitemap it worked from
└── pages/            longer per-page notes, kept out of the prompt
```

From then on, any instruction you give on that domain carries those notes. Elsewhere they are inert.

**Nothing takes effect until you say so.** A map in flight is written to a staging directory the
skill loader cannot read, so an unreviewed map is not merely unused — it is never opened. The panel
shows you the exact markdown as plain text, never rendered, along with the domain it will match.
**Activate** arms it; **Discard** deletes it.

The crawl is read-only and locked to one host. It cannot click, fill or submit; it cannot leave the
site; and it is pinned to the tab it started in, so switching tabs stops it rather than following
you. Limits are enforced by the daemon, and config can narrow them but never widen them:

| Setting | Default | Ceiling |
| --- | --- | --- |
| `maxPages` | 15 | 40 |
| `maxScreenshots` | 10 | 24 |
| `timeoutMs` | 600 000 (10 min) | 1 800 000 (30 min) |

Two switches change what a mapping run may do. `allowClicks` (off by default) lets it reach routes
that only exist behind an interaction. `research` (on by default) lets it use web search for public
background on the domain.

> A map is written from pages an agent read, so read it before activating, as you would any
> generated content. `research` is the one case where a run both reads pages and makes outbound
> requests; turn it off to keep everything inside the browser.

Mapping requires the explicit `@site-mapper` prefix or the Map button — trigger words alone will not
start one, because a mapping run takes minutes and commandeers the tab.

### Writing notes by hand

If you would rather describe a site yourself, upload a markdown file from the side panel’s **Skills** tab:

```markdown
---
name: acme-admin
description: Our internal admin tool.
category: site-exploration
domains: [admin.acme.com]
---

Search is `#q` and submits on Enter, not on the button.
Results lazy load. Click "Load more" until it disappears before counting anything.
```

Notes are **overlays**, not replacements: on a matching site they stack on top of whatever
Browsentic was already doing, so the normal driving and read-only rules still apply. Prefix an
instruction with `@acme-admin` to pin one regardless of where you are.

Notes live outside the repository, are re-read on every run so an edit applies to the next thing you
ask, and `browsentic-mcp skills` lists everything currently in scope.

---

## Recordings: show it once, repeat it later

A site map teaches Browsentic what a site **is**. A recording teaches it what **you do** there.

Press **Record** in the side panel’s **Recordings** tab, do the job yourself — click through the pages, fill the
fields, submit the form — and press stop. Browsentic splits what you did into ordered steps, names
them after what you accomplished, and keeps them in a renameable list. Later, "do it like last time"
runs them again. You can also just say it:

```
record my browsing session
stop recording
```

A recording follows the tab it started in and nothing else. Navigations inside that tab become
steps, other tabs are ignored, and closing the tab stops and saves. It runs for at most **15
minutes**, warns you at 13, and stops itself at the limit.

**What you type is not saved by default.** Every field becomes a placeholder — `{{email}}`,
`{{invoice_number}}` — and the assistant asks you for the value when it replays. Tick **Save what I
type** to keep literal values instead; passwords, hidden fields, one-time codes and anything shaped
like a card number are dropped either way.

Replaying is not blind playback. The steps are a plan, not a script: the agent re-checks each target
against the live page before acting, and prefers the visible text it recorded over the CSS selector,
because selectors are what a redesign breaks first. Anything consequential still waits for approval,
even though you performed it yourself while recording. If a step no longer lands, the run stops and
tells you which one rather than improvising a different route to the same effect.

Recordings live in the extension's own storage rather than on disk, so `browsentic-mcp skills` does
not list them. The one time a recording leaves the browser is the local call that turns the raw
trace into steps.

---

## Skills

Every side-panel instruction is routed to exactly one **base skill**, chosen by trigger words:

| Skill | Handles |
| --- | --- |
| `browser-control` *(default)* | Drive the open tab — click, type, submit, navigate, verify |
| `page-research` | Read and summarise without changing anything |
| `browse-navigation` | Replay a recorded session — "do it like last time" |
| `monitor-progress` | Watch a long-running task and report when it finishes |
| `site-mapper` | Walk a site and write up how it is laid out |
| `captcha` | Get past a "verify you are human" block, or hand a real challenge to you |

Skills are plain markdown. Drop your own into `~/.browsentic/skills/`, or upload one from the panel,
and it shadows a bundled skill of the same name. All three skill directories are re-read on every
run, so an edit applies to the very next instruction.

`browsentic-mcp skills` prints everything the router can see, tagged with where it came from.

---

## Screenshots

The current viewport by default; `fullPage: true` for the whole scroll view, or a `target` for one
element or block. The viewport capture is a single fast grab; a full-page one is stitched from
viewport tiles and paced by the browser's two-captures-per-second limit, so it costs about a second
per screenful.

**Captures do not touch the disk unless you ask.** The image is handed straight back to whoever
called for it, so the screenshots an agent takes to see the page for itself leave nothing behind.
Pass `save: true` for a picture you want to keep: it is written to `~/browsentic/screenshot/`
(mode `0600`) and the result reports the path as `savedTo`.

Very tall pages are stitched from viewport tiles and capped — beyond the limit the bottom is cut off
and the result says `truncated: true`, rather than silently returning a partial image.

---

## Files

Attach a file in the side panel and Browsentic reads it once, at attach time, and keeps notes. The
agent sees those notes — never your filesystem — plus two tools: `page_listFiles` to re-read the
list and `page_attachFile` to put one into a file input on the page. Uploading is treated as
consequential.

---

## One conversation per tab

Each tab gets its own conversation, and several can run at once. A conversation is bound to the tab
it started in: it keeps working there while you read something else, and its actions stay in its own
tab instead of following whichever one you are looking at.

The side panel follows the tab in front. Switch tabs and the chat switches with it — to that tab's
conversation, or to a fresh empty one if it has none. The **Sessions** strip above the chat lists
everything currently open, with each tab's live title, a pulsing dot while it is working, and how
many messages it holds. Click a row to jump to that tab and its transcript; press **×** to end that
session. The strip collapses to a single line when you want the room back.

While a conversation is working, its tab is marked in two places — a dot on the Browsentic toolbar
icon and a dot drawn onto the tab's favicon — so a run you have scrolled away from is still visible
in the tab strip. Closing the panel does not stop anything. **Closing the tab does**: the run is
cancelled and the conversation moves to **History**, where you can reopen it on any tab.

If a conversation opens a tab of its own, that tab joins the same session as a subtab and its work
belongs to the same transcript. It will not act in a tab another conversation has claimed.

Eight tab sessions can be open at once, and three can run at the same time — raise the latter with
`maxConcurrentRuns` in `~/.browsentic/config.json`.

---

## The timeline and approvals

Every action appears as it happens, with what it targeted and what came back. Local commands carry
a ⚡; actions from an MCP client are tagged as external. Cancelling stops the run in the conversation
you are looking at; the others keep going.

Actions that change something other people can see wait for an explicit **Allow** or **Deny**. Form
submission is gated by default, and the gate is smarter than a name match — it also catches
`fillInput`/`typeText` with `pressEnter: true` and pressing Enter, because those submit forms too.
Denying is final: the agent is told to report it and stop, not to find another route to the same
effect.

### Always on this site

The card carries a third button — **Always on ‹host›** — which allows the action and stops asking
for *that action on that host*. It is the answer to a prompt you keep clicking through: a captcha
checkbox on a site you use daily, or Enter-to-submit on a search box.

The grant is a pair, one action and one host, keyed to the site the run started on. It is written
to `~/.browsentic/approvals.json` (mode `0600`), survives restarts, and **only ever short-circuits a
`confirm`** — a `deny` rule stays denied, because those are the ones you are not meant to be able to
click past. The button is hidden when a run has no single site to attach the grant to.

```sh
browsentic-mcp approvals              # what no longer asks
browsentic-mcp approvals clear        # forget all of them
browsentic-mcp approvals clear a.com  # forget one site's
```

Add more actions to `requireApproval` in `~/.browsentic/config.json` if you want them gated, or set
a rule's effect outright — `{ "guardrails": { "rules": { "captcha-solve": "allow" } } }` turns one
off everywhere, including for external MCP clients. The cost of a longer list is a longer list — a
prompt you see on every other tool call is a prompt you stop reading.

---

## For MCP clients

```sh
claude mcp add browsentic -- browsentic-mcp
```

Your client gets the 29 page tools — every one listed with its parameters in [tools.md](tools.md) —
plus:

**`browsentic_status`** — whether the extension is connected, its version, the active tab, any
running monitors, and a `hint` naming the fix when something is wrong. Call it first when a page
tool fails.

**Three read-only resources** that return page context without spending a tool call:

| Resource | Use when |
| --- | --- |
| `browsentic://page/diagram` | You just need the page's shape — the cheapest useful view |
| `browsentic://page/current` | The full `getPageInfo` snapshot as JSON |
| `browsentic://page/text` | You only need the rendered prose |

The tool list is generated from the same registry the extension ships, so it cannot drift from what
the browser can actually do — and if the two halves *are* built from different registries, the
daemon adopts the browser's list and tells your client the tools changed.

Several clients can be registered at once. They share one daemon and one browser, so they interleave:
tool calls stay correctly correlated, but page state can shift under either of them.

---

## Privacy and security

- **Nothing connects until you pair.** A fresh install contacts nothing until you redeem a one-time
  code.
- **Two independent gates.** Any web page can open a WebSocket to loopback, so the daemon first
  classifies the peer by handshake `Origin` — which browsers set themselves and pages cannot forge —
  then requires proof of a pairing code or of an origin-bound session key. A web page can never
  reach the control path.
- **Both ends prove themselves.** Neither secret crosses the wire; each side answers the other's
  nonce. A peer that cannot prove it holds the same secret is abandoned for the next port, so no
  other local process can squat a port and pose as your daemon.
- **Consequential actions ask first**, named in the prompt, in the side panel.
- **Recordings capture what you do, not what you type.** Literal values are opt-in per recording;
  passwords, hidden fields, one-time codes and card numbers are never stored either way. Recording
  only ever starts from your own click or your own words.
- **Agent runs are sandboxed.** The spawned agent gets Browsentic's tools and nothing else — no
  shell, no filesystem, no other MCP servers, and no web access unless a mapping run asked for it.
- **State stays outside the repository**, under `~/.browsentic` and `~/browsentic`.

Two limits worth stating plainly. Pairing controls **which browser**, not which local process:
anything running as your user can read the daemon lockfile and drive an already-paired browser. And
an agent reading a hostile page is still susceptible to prompt injection, so treat page content as
data, never as instructions.

Full list in [installation.md § Limitations](installation.md#limitations).

---

## See also

- [tools.md](tools.md) — every MCP tool and its parameters, as a reference
- [architecture.md](architecture.md) — how the pieces fit together
- [installation.md](installation.md) — prerequisites, setup, configuration, agent switching
