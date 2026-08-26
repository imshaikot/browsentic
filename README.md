![Browsentic](https://raw.githubusercontent.com/imshaikot/browsentic/website/public/og.png)

# Browsentic – Agentic Browsing in the Browser You Already Use

Hand your real, logged-in browser to the AI agent you already run. Browsentic is a browser extension plus a small local daemon: say what you want and it drives the page, ask a question and it reads the page and answers. It runs on [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex/cli) or [Antigravity](https://antigravity.google/docs/cli/install) — whichever you already have logged in — and doubles as an [MCP server](docs/guide/mcp-clients.md) so any MCP client can drive the same browser. No account, no API key, no cloud service.

## Key Capabilities

- **Your Real Browser, Not a Headless One**: Drives the tab in front of you, in your own profile, with your own logins and sessions
- **Bring Your Own Agent**: Runs on the agent CLI you already pay for and are already signed in to — switch between Claude Code, Codex and Antigravity with one click
- **38 Page Capabilities**: Reading, clicking, typing, dragging, on-site search, form submission, navigation, screenshots, captchas, theming and accessibility, background progress monitoring, and pointing at an element
- **Voice, Text, or Demonstration**: Dictate in the side panel, type anywhere, or record yourself doing a job once and later say "do it like last time"
- **Point at What You Mean (A-Eye)**: Press the lens, hover the page, click the thing — the element and its content ride along with your next message, and the agent can hand the lens back when *it* needs you to pick
- **Teach It a Site Once**: Point it at a site and it explores and writes reusable notes, so every later session already knows its way around
- **Instant Commands**: "Go back", "scroll to the top", "open github.com" run in the browser in milliseconds instead of becoming an agent round trip
- **Guardrails, Not Vibes**: A declarative policy gates consequential actions, confines each run to the sites it is about, and marks every byte of page text as untrusted data — tunable per rule from a Settings tab, with nothing overridden until you say so
- **Off By Default**: A fresh install contacts nothing until you redeem a one-time pairing code

## Quick Start

Clone and build both halves — the extension and the local daemon (requires [Node.js](https://nodejs.org) 20 or newer):

```sh
git clone https://github.com/imshaikot/browsentic.git
cd browsentic
node scripts/setup.mjs
```

Load the extension at `chrome://extensions` → **Developer mode** → **Load unpacked** → `dist/chrome-mv3`.

Then put the CLI on your `PATH` and pair your browser:

```sh
yarn mcp:link
browsentic-mcp pair
```

Paste the printed code into the Browsentic popup, press **Connect**, and open the side panel.

You also need one agent CLI on your `PATH` and logged in — `claude`, `codex` or `agy`. Full prerequisites in the [install guide](docs/guide/install.md).

## How It Works

![How an instruction becomes a click](https://raw.githubusercontent.com/imshaikot/browsentic/website/public/flow.png)

<details>
<summary>The same flow, as text</summary>

```
You ──speak or type──> Extension ──local WebSocket──> Daemon ──spawns──> your agent CLI
                            ▲                                        (claude │ codex │ agy)
                            └──────────────── page actions ─────────────────────┘

Any MCP client ──stdio──> browsentic-mcp ──> the same daemon ──> the same browser
```

</details>

The extension dials out to the daemon, because a Manifest V3 service worker cannot listen for connections. One daemon owns the browser link, so several MCP clients can share one browser. Everything binds to `127.0.0.1`.

## Resources

- 📚 [Documentation](docs/)
- 🚀 [Install and Pair](docs/guide/install.md)
- ✨ [Features](docs/guide/features/)
- 🧰 [All 38 Page Tools](docs/reference/tools.md)
- 🔌 [Use It From Claude Code, Cursor or Zed](docs/guide/mcp-clients.md)
- 🛡️ [Approvals and Guardrails](docs/guide/approvals.md)
- 🏗️ [Architecture](docs/internals/)
- 🩺 [Troubleshooting](docs/guide/troubleshooting.md)

## Privacy and Security

- **Nothing Connects Until You Pair**: An unpaired extension never contacts the daemon
- **Two Independent Gates**: The daemon classifies every peer by handshake `Origin` — which browsers set and pages cannot forge — then demands proof of a pairing code or an origin-bound session key. A web page can never reach the control path
- **Both Ends Prove Themselves**: Neither secret crosses the wire; each side answers the other's nonce, so no local process can squat a port and pose as your daemon
- **Consequential Actions Ask First**: Form submission, file upload, answering a captcha and leaving the run's sites all pause for an explicit Allow or Deny
- **Agent Runs Are Contained**: The spawned CLI gets Browsentic's tools and nothing else — no shell, no filesystem, no other MCP servers, and a sealed environment stripped of your cloud keys and tokens
- **Credentials Are Sealed, Not Read**: A deterministic sanitizer runs on both sides of the socket. Passwords, keys, tokens, cookies and card numbers found in a page are replaced by a placeholder before the agent ever sees them, and become plaintext again only in the field they are typed into
- **Recordings Capture What You Do, Not What You Type**: Passwords, hidden fields, one-time codes and card numbers are never stored

Two limits worth stating plainly: pairing controls **which browser**, not which local process, and an agent reading a hostile page is still susceptible to prompt injection. Both are covered in [Limits](docs/guide/limits.md).

Browsentic is provided as is, without warranty — you are responsible for what you approve and where you point it. The plain-language version, and how to report a vulnerability privately, are in [SECURITY.md](SECURITY.md).

## Contributing

Found a bug 🐛 or have an idea for a capability ✨? Adding a page capability is one file plus one line in the registry, which publishes it as an MCP tool at the same time. See the [contributing guide](docs/internals/contributing.md) for the setup, the checks, and the four conventions that are load-bearing at runtime.

## License

Browsentic is MIT licensed.

- **Source Available**: Always visible source code
- **Local First**: No cloud component, no telemetry, no account
- **Extensible**: Add your own page capabilities, skills and agent runners

## What does Browsentic mean?

**Short answer:** "Browse" + "agentic".

**Long answer:** Most browser automation asks you to hand the work to a *different* browser — a headless one, in a container, logged in to nothing. Browsentic is the other way round: the agentic part happens in the browser you are already looking at, with the sessions you are already signed in to. The name is the thesis — browsing, made agentic, where you already browse.
