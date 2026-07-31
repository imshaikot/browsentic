# Browsentic

> Reimagine browsing as agentic. Browsentic hands your real, logged-in browser to the AI agent you already run — instruct it by voice, by typing, or by showing it once — and it turns that into real actions on the tab in front of you: clicking, filling, reading, navigating.

![License](https://img.shields.io/badge/license-MIT-blue)
![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)

Browsentic is a browser extension plus a small local daemon. Say what you want and it drives the page. Ask a question and it reads the page and answers. Every action it takes shows up on a live timeline, and anything consequential waits for your approval first.

It runs on **your own [Claude Code](https://claude.com/claude-code) login**. There is no Anthropic API client in this repository and no API key to configure.

## Features

- **Voice or text.** Hands free dictation in the side panel, press to talk in the popup, plain typing anywhere.
- **Real page control.** 19 page capabilities covering reading, clicking, typing, form submission, navigation and screenshots.
- **Site maps.** Point Browsentic at a site and it explores it, then writes reusable notes so later sessions already know their way around. See [Site maps](#site-maps-teach-it-a-site-once).
- **Recordings.** Do a repetitive job once yourself and Browsentic keeps it as ordered steps, so "do it like last time" repeats it. See [Recordings](#recordings-show-it-once-repeat-it-later).
- **Instant commands.** "Go back", "scroll to the top", "open github.com" run in the browser in milliseconds instead of becoming an agent run.
- **Works as an MCP server.** Claude Code or any other MCP client can drive your real, logged in browser through the same local daemon.
- **Off by default.** A fresh install connects to nothing until you redeem a one time pairing code.

## How it works

```
You ──speak or type──> Extension ──local WebSocket──> Daemon ──spawns──> your Claude Code
                            ▲                                                   │
                            └──────────────── page actions ─────────────────────┘

Any MCP client ──stdio──> browsentic-mcp ──> the same daemon ──> the same browser
```

The extension dials out to the daemon, because a Manifest V3 service worker cannot listen for
connections. One daemon owns the browser link, so several MCP clients can share one browser.

## Requirements

- Chrome or another Chromium browser (Firefox builds work too)
- Node.js 20 or newer
- [Claude Code](https://claude.com/claude-code) on your `PATH`

## Quick start

```sh
git clone https://github.com/your-org/browsentic.git
cd browsentic
yarn install
yarn build
```

Load the extension: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**
and select `dist/chrome-mv3`.

Then install the daemon and pair your browser:

```sh
yarn mcp:install     # the daemon is a separate package with its own dependencies
yarn mcp:build
yarn mcp:link        # puts `browsentic-mcp` on your PATH
browsentic-mcp pair   # prints a single use code, valid for 10 minutes
```

Open the Browsentic popup, paste the code and press **Connect**. The daemon issues a long lived
session key that survives browser and daemon restarts, and dies only when you revoke it.

That is the whole setup. Open the side panel and start talking.

## Usage

Type or speak an instruction into the side panel. Replies stream back token by token, each page
action appears on a timeline as it happens, and follow ups continue the same conversation, so
"now click the second one" works.

Actions that change something other people can see wait for an explicit **Allow** or **Deny**.
Form submission is gated by default.

## Site maps: teach it a site once

An agent that has never seen your site spends its first minutes rediscovering it: where search
lives, what a button is really called, why the list looks empty until you scroll. Site maps do
that exploration once and keep the result.

Press **Map** in the Skills panel, or say:

```
@site-mapper map this site
```

Browsentic reads the site's own `robots.txt` and `sitemap.xml`, looks up public background on the
domain, then walks the site for a few minutes, taking screenshots as it goes. The result is a set
of notes scoped to that domain:

```
~/browsentic/skills/acme-com/
├── SKILL.md          landmarks, key pages, how they connect, quirks
├── map.json          the structured report behind it
├── screenshots/      captures taken during the crawl
├── evidence/         the robots.txt and sitemap it worked from
└── pages/            longer per page notes, kept out of the prompt
```

From then on, any instruction you give on that domain carries those notes. Elsewhere they are
inert.

**Nothing takes effect until you say so.** A map in flight is written to a staging directory the
skill loader cannot read, so an unreviewed map is not merely unused, it is never opened. The panel
shows you the exact markdown as plain text, never rendered, along with the domain it will match.
**Activate** arms it, **Discard** deletes it.

The crawl is read only and locked to one host. It cannot click, fill or submit, it cannot leave the
site, and it is pinned to the tab it started in, so switching tabs stops it rather than following
you. Size limits are enforced by the daemon, and config can narrow them but never widen them:

| Setting | Default | Ceiling |
| --- | --- | --- |
| `maxPages` | 15 | 40 |
| `maxScreenshots` | 10 | 24 |
| `timeoutMs` | 600000 (10 min) | 1800000 (30 min) |

Two switches change what a mapping run is allowed to do. `allowClicks` (off by default) lets it
reach routes that only exist behind an interaction. `research` (on by default) lets it use web
search for public background on the domain.

> A map is written from pages an agent read, so read it before activating, as you would any
> generated content. `research` is the one case where a run both reads pages and makes outbound
> requests; turn it off to keep everything inside the browser.

### Writing notes by hand

If you would rather describe a site by hand, upload a markdown file from the side panel composer:

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

Notes are overlays rather than replacements: on a matching site they are added on top of whatever
Browsentic was already doing, so the normal driving and read only rules still apply. Prefix an
instruction with `@acme-admin` to pin one regardless of where you are.

Notes live outside the repository, are re-read on every run so an edit applies to the next thing
you ask, and `browsentic-mcp skills` lists everything currently in scope.

## Recordings: show it once, repeat it later

A site map teaches Browsentic what a site **is**. A recording teaches it what **you do** there.

Press the red record button in the composer, then do the job yourself — click through the pages,
fill the fields, submit the form — and press stop. Browsentic splits what you did into ordered
steps, names them after what you accomplished, and keeps them in a list you can rename. Later,
"do it like last time" runs them again. You can also just say it:

```
record my browsing session
stop recording
```

A recording follows the tab it started in and nothing else. Navigations inside that tab become
steps, other tabs are ignored, and closing the tab stops and saves. It runs for at most **15
minutes**, warns you at 13, and stops itself at the limit.

**What you type is not saved by default.** Every field you fill becomes a placeholder — `{{email}}`,
`{{invoice_number}}` — and the assistant asks you for the value when it replays. Tick **Save what I
type** if you would rather keep the literal values; passwords, hidden fields, one time codes and
anything shaped like a card number are dropped either way.

Replaying is not blind playback. The steps are a plan, not a script: the agent re-checks each target
against the live page before acting, and prefers the visible text it recorded over the CSS selector,
because selectors are what a redesign breaks first. Anything consequential still waits for your
approval, even though you performed it yourself while recording. If a step no longer lands, the run
stops and tells you which one, rather than improvising a different route to the same effect.

Recordings live in the extension's own storage rather than on disk, so `browsentic-mcp skills` does
not list them. The one time a recording leaves the browser is the local `claude -p` call that turns
the raw trace into steps.

## Instant commands

Sending "go back" out to a language model costs a round trip and a few seconds to arrive at
something the extension could do immediately. So every instruction is scored against a local
grammar first. Confident single step commands run in the browser and stop there, marked with a
bolt on the timeline. Everything else goes to the agent with the text untouched.

| Runs locally | Goes to the agent |
| --- | --- |
| back, forward, reload | "is there a login button?" |
| open github.com, open localhost:3000 | "open the settings menu" |
| google something, search the web for something | "search for wireless headphones" |
| scroll up, down, top, bottom, page down | "scroll down and tell me what it says" |
| press enter, hit escape, press arrow down | "click sign in and then fill in my email" |
| click Sign in, tap Continue | "click Buy now", "click it" |
| record my browsing session, stop recording | "record a video of this page" |

The bias is toward escalating, because the two mistakes are not symmetric. Escalating something it
could have handled costs a round trip. Acting on something it misread spends a wrong click on your
real page. Questions, multi step asks, conditionals, vague targets and consequential clicks all go
to the agent, as does any local command that runs and fails.

## Use it from Claude Code

```sh
claude mcp add browsentic -- browsentic-mcp
```

Claude Code now has 19 page tools plus `browsentic_status`, and three read only resources that
return page context without spending a tool call. Tool definitions are generated from the same
registry the extension ships, so they cannot drift from what the browser can actually do.

## What it can do

| Category | Capabilities |
| --- | --- |
| Read | Structured page snapshot with a layout diagram and stable selectors, rendered text or HTML, wait for an element to appear or vanish, screenshot the tab or one element |
| Act | Click, hover, focus, type into inputs and contenteditables, choose a `<select>` option, select text, press keys with modifiers, submit a form |
| Move | Open a URL, back, forward, reload, scroll to an element or position |
| Files | List files stored in Browsentic and attach one to a file input on the page |
| Recordings | List the browsing sessions the user recorded, and read one back as ordered, replayable steps |

Most capabilities take a target described by CSS selector, visible text, ARIA role or index.
Targeting by visible text survives redesigns that break selectors.

## Configuration

Optional, at `~/.browsentic/config.json`:

```json
{
  "claudeBin": "/opt/homebrew/bin/claude",
  "requireApproval": ["page.submitForm"],
  "screenshotDir": "~/browsentic/screenshot",
  "skillsDir": "~/browsentic/skills",
  "siteMap": { "research": true, "allowClicks": false, "maxPages": 15 }
}
```

Useful commands:

```sh
browsentic-mcp status      # daemon and extension state
browsentic-mcp sessions    # which browsers are paired
browsentic-mcp revoke      # unpair everything, or one origin
browsentic-mcp skills      # every skill in scope, and where it came from
browsentic-mcp logs        # run starts, routed skills, every tool call
browsentic-mcp stop
```

## Privacy and security

- **Nothing connects until you pair.** An unpaired extension never contacts the daemon.
- **Two independent gates.** Any web page can open a WebSocket to loopback, so the daemon first
  classifies the peer by handshake `Origin`, which browsers set themselves and pages cannot forge,
  then requires a pairing token or a session key bound to that same origin. A web page can never
  reach the control path.
- **Consequential actions ask first.** Approval prompts appear in the side panel with the action
  named. Cancelling a run stops it mid flight.
- **Recordings capture what you do, not what you type.** A recording stores the identity of each
  field you fill and a placeholder for its value. Opting in to keeping literal values is per
  recording and off by default, and passwords, hidden fields, one time codes and card numbers are
  never stored either way. Recording only ever starts from your own click or your own words.
- **Speech uses the browser's built in recognition.** Chrome's Web Speech API streams audio to
  Google to transcribe it. No model is bundled and nothing is downloaded. Replacing the speech
  engine is a one file change.
- **State stays outside the repository.** Pairing keys, logs, config, skills and screenshots live
  under `~/.browsentic` and `~/browsentic`.

Two limits worth stating plainly. Pairing controls **which browser**, not which local process:
anything running as your user can read the daemon lockfile and drive an already paired browser.
And an agent reading a hostile page is still susceptible to prompt injection, so treat page content
as data, never as instructions.

## Development

```sh
yarn dev              # build, launch a throwaway Chrome profile, hot reload
yarn dev:firefox
yarn build            # production build
yarn zip              # store ready archive
yarn compile          # type check
yarn intent:check     # route a fixture table of utterances through the local grammar
yarn mcp:build        # rebuild the daemon and MCP server
yarn mcp:manifest     # print the tool manifest, no browser needed
```

Explain a single routing decision:

```sh
yarn intent:check "take me to the checkout page"
```

Yarn 4 is the package manager and the release is pinned inside the repository, so whichever `yarn`
is on your `PATH` re-executes into the right one. No global install or Corepack setup is needed.

Built with [WXT](https://wxt.dev), React 19, TypeScript, Tailwind CSS v4,
[shadcn/ui](https://ui.shadcn.com) and [zod](https://zod.dev).

## Contributing

Issues and pull requests are welcome. Adding a page capability is a single file plus one line in
the registry, which publishes it as an MCP tool at the same time. Four conventions in an action
module are load bearing at runtime rather than at compile time: touch `document`/`window` only
inside `execute()`, keep underscores out of action names, `.describe()` every input field, and
validate with `ActionError` inside `execute()` rather than zod `.refine()`/`.transform()`.

Before opening a pull request, run `yarn compile`, `yarn compile:mcp`, `yarn intent:check`,
`yarn security:check` and `yarn mcp:manifest`.

## License

MIT
