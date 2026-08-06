# Installation

Browsentic is two halves — a browser extension and a local daemon — plus a pairing step that
connects them. Budget about five minutes.

There is no account, no API key and no cloud service. Browsentic drives your real browser using the
AI agent you already run locally.

---

## Prerequisites

| | Requirement | Check |
| --- | --- | --- |
| **Node** | 20 or newer | `node --version` |
| **Browser** | Chrome, or another Chromium browser (Edge, Brave, Arc). Firefox has a build target. | — |
| **Agent** | [Claude Code](https://claude.com/claude-code) on your `PATH`, logged in | `claude --version` |
| **git** | To clone the repository | `git --version` |

Notes:

- **Claude Code is required for the side panel**, and only for the side panel. It is what the daemon
  spawns to reason about an instruction. If you only ever drive the browser from an MCP client, the
  daemon never spawns anything and Claude Code is optional — see
  [Using a different agent](#using-a-different-agent).
- **Keep Claude Code reasonably current.** Browsentic passes flags that sandbox the run
  (`--strict-mcp-config`, `--disallowedTools`, `--append-system-prompt`). An older build that does
  not understand them fails the run with an explicit "update Claude Code" message rather than
  running unsandboxed.
- **Yarn is not a prerequisite.** The pinned Yarn 4 release ships inside the repository and the
  setup script invokes it through Node. No global install, no Corepack.
- **@browsentic/mcp is not published to npm.** Install from source; `npx -y @browsentic/mcp` will
  not resolve.

---

## 1. Clone and build

```sh
git clone https://github.com/imshaikot/browsentic.git
cd browsentic
node scripts/setup.mjs
```

That runs four steps: extension dependencies, extension build, daemon dependencies, daemon build.
`mcp/` is a separate Yarn project with its own lockfile, which is why the root install does not
cover it. Once dependencies exist, `yarn setup` re-runs the same thing.

When it finishes you have:

```
dist/chrome-mv3     the unpacked extension
mcp/dist            the daemon and MCP server
```

## 2. Load the extension

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `dist/chrome-mv3`

Pin Browsentic to the toolbar so the popup is one click away.

For Firefox: `yarn build:firefox`, then load `dist/firefox-mv2` through `about:debugging` →
**This Firefox** → **Load Temporary Add-on**. Firefox is a supported build target, but Chromium is
what Browsentic is developed against.

## 3. Put the CLI on your PATH

```sh
yarn mcp:link
```

This runs `npm link` inside `mcp/`, which writes `browsentic-mcp` and `browsentic-mcpd` to your
global npm prefix. It reaches outside the repository, which is why it is a separate step from the
build.

Confirm:

```sh
browsentic-mcp --version
```

If the command is not found, your global npm prefix is not on `PATH`. Find it with
`npm prefix -g` and add its `bin` directory.

## 4. Pair your browser

```sh
browsentic-mcp pair
```

This starts the daemon if it is not already running and prints a code:

```
  Pairing code:  K7QM-3XPT

  Open the Browsentic popup, paste it, and press Connect.
  Expires in 10 minutes and works once.
```

Open the Browsentic popup, paste the code, press **Connect**. The daemon issues a long-lived session
key that survives browser and daemon restarts, and dies only when you revoke it.

Verify:

```sh
browsentic-mcp status
```

```
daemon:    running on 127.0.0.1:8765 (pid 41207, v0.1.7)
extension: connected (v0.1.7)
manifest:  in sync
paired:    1
```

Open the side panel and start talking. That is the whole setup.

---

## 5. Register with an MCP client (optional)

Pairing connects your browser to the daemon. Registering an MCP client lets *that client* drive the
same browser.

**Claude Code:**

```sh
claude mcp add browsentic -- browsentic-mcp
```

**Any other stdio MCP client** — the command is always `browsentic-mcp` with no arguments. Most
clients take a JSON block of this shape:

```json
{
  "mcpServers": {
    "browsentic": { "command": "browsentic-mcp" }
  }
}
```

Codex CLI uses TOML in `~/.codex/config.toml` instead:

```toml
[mcp_servers.browsentic]
command = "browsentic-mcp"
```

Check your client's own documentation for the exact file and key — the *command* is the part that
matters, and it is the same everywhere.

The client then gets 28 page tools, `browsentic_status`, and three read-only resources.
**MCP servers are loaded at session start**, so restart the client session after registering.

---

## Using a different agent

Worth being precise here, because Browsentic has two independent agent surfaces and only one of them
is switchable.

### The side panel: Claude Code only

The in-extension agent spawns `claude -p` and speaks Claude Code's CLI protocol — `stream-json`
output, `--mcp-config`, `--allowedTools`, `--session-id`/`--resume`, `--append-system-prompt`. There
is no adapter for Codex, Gemini CLI or any other agent, and pointing `claudeBin` at a different
binary will not work: it would be handed flags it does not understand.

What you *can* change is which Claude runs it, in `~/.browsentic/config.json`:

```json
{
  "claudeBin": "/opt/homebrew/bin/claude",
  "model": "claude-sonnet-5",
  "effort": "high"
}
```

| Key | Default | Effect |
| --- | --- | --- |
| `claudeBin` | `claude` | Path to the Claude Code binary. Set this when the daemon's `PATH` differs from your shell's — the usual cause of `NO_CLAUDE`. |
| `model` | `claude-sonnet-5` | Passed as `--model`. Use `claude-opus-5` for harder multi-step work, `claude-haiku-4-5-20251001` for speed. |
| `effort` | unset | Passed as `--effort`: `low`, `medium`, `high`, `xhigh`, `max`. |

Changes apply to the next run — the config is re-read each time, no daemon restart needed.

### Everything else: any MCP client

The other direction is fully agent-agnostic. Browsentic is a plain stdio MCP server, so **Codex CLI,
Gemini CLI, Cursor, Zed, Claude Desktop** — anything that speaks MCP — can drive your real browser
through the same daemon and the same paired session. Register it as shown
[above](#5-register-with-an-mcp-client-optional).

So the practical answer to "can I use Browsentic with Codex or Gemini?" is **yes, as an MCP client**.
You drive the browser from that agent's own interface, with its own permission prompts, rather than
from Browsentic's side panel.

The two surfaces differ in more than which model runs them:

| | Side panel (agent run) | MCP client |
| --- | --- | --- |
| Agent | Claude Code, spawned by the daemon | Whatever you registered |
| Approval gate | Yes — `requireApproval`, prompts in the panel | No — your client's own permissions apply |
| Timeline | Every action, live | Actions appear tagged `external` |
| Skills / site notes | Routed and applied automatically | Not applied |
| Recordings, site mapping | Available | Readable only (`page_listRecordings`, `page_readRecording`) |
| Appears in `browsentic-mcp logs` | Yes | Yes |
| Voice input | Yes | No |

Several clients can be registered at once. They share one daemon and one browser, so they interleave
— tool calls stay correctly correlated, but page state can shift under either of them.

---

## Configuration reference

Everything is optional. `~/.browsentic/config.json`:

```json
{
  "claudeBin": "/opt/homebrew/bin/claude",
  "model": "claude-sonnet-5",
  "effort": "high",
  "requireApproval": ["page.submitForm"],
  "screenshotDir": "~/browsentic/screenshot",
  "skillsDir": "~/browsentic/skills",
  "siteMap": {
    "research": true,
    "allowClicks": false,
    "maxPages": 15,
    "maxScreenshots": 10,
    "timeoutMs": 600000
  }
}
```

| Key | Default | Notes |
| --- | --- | --- |
| `requireApproval` | `["page.submitForm"]` | Actions an agent run must ask about first. Listing `page.submitForm` also catches `pressEnter: true` and pressing Enter, because those submit forms too. Add `"page.closeTab"` to approve each tab close, and so on — but a prompt you see on every other tool call is a prompt you stop reading. |
| `screenshotDir` | `~/browsentic/screenshot` | Where captures are written, mode `0600`. |
| `skillsDir` | `~/browsentic/skills` | Where panel uploads and generated site maps live. |
| `siteMap.research` | `true` | Lets a mapping run use web search for public background on the domain. Turn it off to keep everything inside the browser. |
| `siteMap.allowClicks` | `false` | Lets a mapping run reach routes that only exist behind an interaction. |
| `siteMap.maxPages` | 15 | Ceiling 40. |
| `siteMap.maxScreenshots` | 10 | Ceiling 24. |
| `siteMap.timeoutMs` | 600 000 | Ceiling 1 800 000 (30 min). |

Config can narrow the mapping limits but never widen them past the compiled ceilings.

`BROWSENTIC_HOME` relocates the whole state directory if you need it somewhere other than
`~/.browsentic`.

---

## Limitations

Read this section before deciding where Browsentic fits.

### It needs a real browser, open

There is no headless mode. Browsentic drives the browser you are looking at, in your real profile
with your real logins. Close the browser and every tool call returns `EXTENSION_OFFLINE`. If you
want anonymous fetching of a static page, an ordinary HTTP fetch is the right tool.

### Pages that refuse content scripts

`chrome://` pages, the Chrome Web Store and the new-tab page cannot host a content script, so most
tools return `TAB_UNREACHABLE` there. `page_navigate` still works and is the way out. Ordinary sites
self-heal: a tab that loaded before the extension did gets a content script injected on first
contact.

### One browser link, one run at a time

The daemon keeps a single live extension connection — a newer one supersedes the old. Several
browsers can be *paired*, but only one is connected at a time. Within the side panel, one
instruction runs at a time; a second returns `RUN_IN_PROGRESS`.

### Pairing controls which browser, not which process

This is the security boundary worth understanding. Pairing binds a browser. It does not
authenticate local programs: anything running as your user can read `~/.browsentic/daemon.json` and
drive an already-paired browser through the control port. Browsentic assumes your user account is
the trust boundary.

### Prompt injection is a real risk

An agent reading a hostile page is susceptible to instructions embedded in that page. Browsentic
frames all page text as untrusted data in the system prompt and re-states it around every injected
block, but this is mitigation, not a guarantee. The approval gate is the backstop: keep it on for
anything consequential, and be deliberate about running agent instructions on sites you do not
trust.

### Approval only gates agent runs

Direct MCP invocations do **not** pass the approval gate and do not appear as approval prompts —
they rely on your MCP client's own permission system. Do not assume something the side-panel agent
was denied is safe to do from an MCP client instead.

### Speech goes to Google

Voice input uses Chrome's built-in Web Speech API, which streams audio to Google for transcription.
No model is bundled and nothing is downloaded. If that is not acceptable, type instead — it is one
file to replace the speech engine.

### Recording and mapping limits

Recordings run for at most 15 minutes, follow one tab, live in extension storage rather than on
disk, and drop passwords, hidden fields, one-time codes and card numbers unconditionally. Site
mapping is read-only, locked to one host and one tab, and capped as in the table above. Mapping mode
requires the explicit `@site-mapper` prefix or the Map button — trigger words alone will not start
one.

### Screenshots of very tall pages

Full-page capture stitches viewport tiles, capped at 48 tiles and a 16 384 px canvas side. Beyond
that the bottom is cut off and the result reports `truncated: true`.

### Loopback ports

The daemon binds the first free port of 8765, 8766, 8767. If all three are taken it will not start.

### Unpacked extension

Installing from source means Chrome will not auto-update it, and will not auto-reload it after a
rebuild — you must press ↻ at `chrome://extensions`. Chrome may also prompt about developer-mode
extensions on each launch.

---

## Updating

```sh
git pull
yarn setup
```

Then reload the extension at `chrome://extensions` (↻ on the Browsentic card) and restart the
daemon:

```sh
browsentic-mcp stop
```

It restarts automatically on the next call. **Rebuild both halves together.** If only one side is
rebuilt, `browsentic-mcp status` reports `manifest: DRIFTED` — the daemon falls back to the tools
the browser actually has and tells your MCP client the list changed, but you should fix the drift
rather than run on it.

Your pairing survives updates. `yarn mcp:link` only needs re-running if the link is broken.

---

## Uninstalling

```sh
browsentic-mcp revoke      # unpair every browser
browsentic-mcp stop        # stop the daemon
yarn mcp:unlink            # remove browsentic-mcp from PATH
rm -rf ~/.browsentic ~/browsentic
```

Then remove the extension at `chrome://extensions`. That also clears recordings and stored files,
which live in extension storage.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Popup shows `Expected {op:…}` | Stale service worker after a rebuild | `chrome://extensions` → ↻ reload Browsentic |
| "That pairing code is wrong or expired" | Codes are single-use and last 10 minutes | `browsentic-mcp pair` for a fresh one. A failed attempt does not burn the outstanding code. |
| "No Browsentic daemon is running" | Nothing on 8765–8767 | `browsentic-mcp status`; check the log with `browsentic-mcp logs` |
| Tools missing from an MCP session | The server was registered mid-session | Restart the client session — MCP servers load at start |
| `manifest: DRIFTED` | Extension and CLI built from different registries | `yarn build && yarn mcp:build`, then reload the extension |
| `NO_CLAUDE` | Claude Code is not on the daemon's `PATH` | Set `claudeBin` to an absolute path in `config.json` |
| "does not understand the flags Browsentic uses to sandbox a run" | Claude Code is too old | Update Claude Code |
| `EXTENSION_OFFLINE` | Browser closed, or not paired | Open the browser; `browsentic-mcp sessions` to check pairing |
| `TAB_UNREACHABLE` on a normal site | The extension needs reloading | ↻ at `chrome://extensions`; ordinary sites otherwise self-heal |
| `RUN_IN_PROGRESS` | One instruction at a time | Cancel the running one in the side panel |
| An action ran but nothing appears in `logs` | It matched the local intent grammar and never reached the daemon | Expected — those carry a ⚡ on the timeline. `yarn intent:check "<what you said>"` explains the routing. |

Useful commands:

```sh
browsentic-mcp status      # daemon and extension state
browsentic-mcp sessions    # which browsers are paired
browsentic-mcp revoke      # unpair everything, or one origin
browsentic-mcp skills      # every skill in scope, and where it came from
browsentic-mcp tools       # the tool manifest, no browser needed
browsentic-mcp logs        # run starts, routed skills, every tool call
browsentic-mcp token       # the control token, for MCP clients
browsentic-mcp stop
```

The daemon log lives at `~/.browsentic/daemon.log`.

---

## Development setup

```sh
yarn dev              # build, launch a throwaway Chrome profile, hot reload
yarn dev:firefox
yarn build            # production build
yarn zip              # store-ready archive
yarn compile          # type check the extension
yarn compile:mcp      # type check the daemon
yarn mcp:dev          # rebuild the daemon on change
yarn mcp:manifest     # print the tool manifest, no browser needed
yarn intent:check     # route a fixture table of utterances through the local grammar
yarn security:check
```

Before opening a pull request, run `yarn compile`, `yarn compile:mcp`, `yarn intent:check`,
`yarn security:check` and `yarn mcp:manifest`.

See [architecture.md](architecture.md) for how the pieces fit together, and
[features.md](features.md) for what they do.
