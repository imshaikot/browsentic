![Browsentic: your browser's superpower, free and open source](docs/assets/social-card.png?v=0.7.0)

# Browsentic – a completely integrated agentic browser extension

[![npm version](https://img.shields.io/npm/v/browsentic)](https://www.npmjs.com/package/browsentic)
[![npm downloads](https://img.shields.io/npm/dm/browsentic)](https://www.npmjs.com/package/browsentic)
[![CI](https://img.shields.io/github/actions/workflow/status/imshaikot/browsentic/ci.yml?branch=main&label=CI)](https://github.com/imshaikot/browsentic/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/browsentic)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/browsentic)](LICENSE)

Hand your real, logged-in browser to the AI agent you already run. Browsentic is a browser extension with an AI side panel, plus a small local daemon: open the panel beside any tab, say what you want and it drives the page, ask a question and it reads the page and answers. It runs on the agent CLI you already have logged in — seven are supported — and doubles as an [MCP server](docs/guide/mcp-clients.md) so any MCP client can drive the same browser. No account, no API key, no cloud service.

<p>
  <strong>Works in</strong>&ensp;
  <a href="docs/guide/install.md"><img src="https://browsentic.com/icons/chrome.svg" width="18" height="18" alt="Chrome"></a>&nbsp;Chrome&ensp;·&ensp;
  <a href="docs/guide/install.md#firefox"><img src="https://browsentic.com/icons/firefox.svg" width="18" height="18" alt="Firefox"></a>&nbsp;Firefox&ensp;·&ensp;
  <a href="docs/guide/install.md"><img src="https://browsentic.com/icons/edge.svg" width="18" height="18" alt="Edge"></a>&nbsp;Edge&ensp;·&ensp;
  <a href="docs/guide/install.md"><img src="https://browsentic.com/icons/brave.svg" width="18" height="18" alt="Brave"></a>&nbsp;Brave&ensp;·&ensp;
  <a href="docs/guide/install.md"><img src="https://browsentic.com/icons/arc.svg" width="18" height="18" alt="Arc"></a>&nbsp;Arc
</p>
<p>
  <strong>Runs on</strong>&ensp;
  <img src="https://browsentic.com/icons/claude.svg" width="18" height="18" alt="">&nbsp;<a href="https://claude.com/claude-code">Claude Code</a>&ensp;·&ensp;
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://browsentic.com/icons/openai-dark.svg"><img src="https://browsentic.com/icons/openai.svg" width="18" height="18" alt=""></picture>&nbsp;<a href="https://developers.openai.com/codex/cli">Codex</a>&ensp;·&ensp;
  <img src="https://browsentic.com/icons/antigravity.svg" width="18" height="18" alt="">&nbsp;<a href="https://antigravity.google/docs/cli/install">Antigravity</a>&ensp;·&ensp;
  <img src="https://browsentic.com/icons/mistral.svg" width="18" height="18" alt="">&nbsp;<a href="https://github.com/mistralai/mistral-vibe">Mistral Vibe</a> <sup>beta</sup>&ensp;·&ensp;
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://browsentic.com/icons/xai-dark.svg"><img src="https://browsentic.com/icons/xai.svg" width="18" height="18" alt=""></picture>&nbsp;<a href="https://docs.x.ai/build/overview">Grok Build</a> <sup>beta</sup>&ensp;·&ensp;
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://browsentic.com/icons/cursor-dark.svg"><img src="https://browsentic.com/icons/cursor.svg" width="18" height="18" alt=""></picture>&nbsp;<a href="https://cursor.com/docs/cli/overview">Cursor CLI</a> <sup>beta</sup>&ensp;·&ensp;
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://browsentic.com/icons/qwen-dark.svg"><img src="https://browsentic.com/icons/qwen.svg" width="18" height="18" alt=""></picture>&nbsp;<a href="https://qwenlm.github.io/qwen-code-docs/en/">Qwen Code</a> <sup>beta</sup>
</p>

## Quick Start

**macOS** — one line installs [Browsentic.app](docs/guide/mac-app.md), and the app installs everything else, Node included, and runs it from a window:

```sh
curl -fsSL https://browsentic.com/install.sh | sh
```

**Any platform** — with [Node.js](https://nodejs.org) 20 or newer:

```sh
npx browsentic setup
```

Either way two steps are left, both inside the browser: **Load unpacked** `~/browsentic/extension/chrome-mv3` at `chrome://extensions`, then paste the pairing code into the Browsentic popup. On Firefox, run `npx browsentic setup --browser firefox` instead: it links the signed `.xpi` from the [release](https://github.com/imshaikot/browsentic/releases/latest), and there is no folder to load. You also need one agent CLI logged in — `claude`, `codex`, `agy`, `vibe` (beta), `grok` (beta), `cursor-agent` (beta) or `qwen` (beta). Windows and Linux follow the same two steps; the folder is under your home directory there too. Details, updating and building from source are in the [install guide](docs/guide/install.md).

## Key Capabilities

- **A Side Panel, Not a Terminal**: Open it beside any tab, type or dictate, and watch every action land on a timeline with approvals where you are looking. The terminal is optional: the same daemon doubles as an MCP server for Claude Code, Cursor or Zed
- **Your Real Browser, Not a Headless One**: Drives the tab in front of you, in your own profile, with your own logins and sessions
- **Bring Your Own Agent**: Runs on the agent CLI you already have and are already signed in to — switch between Claude Code, Codex, Antigravity, Mistral Vibe, Grok Build, Cursor CLI and Qwen Code with one click, and pick the model each one runs
- **52 Page Capabilities**: Reading, clicking, typing, dragging, on-site search, form submission, navigation, stepping into iframes, screenshots, file upload and download, captchas, theming and accessibility, console and network diagnostics, background progress monitoring, scheduled and repeating jobs, pointing at an element, and calling the tools a WebMCP site registers for agents
- **Live Tools, Off By Default**: For work that repeats twenty times or needs something no tool covers, flip the **Live tool** switch and the agent may write a small script for the page — you read the code in the panel and approve it before a line of it runs
- **Keep What It Wrote**: A script that worked can be kept as a tool of your own, named after the site it belongs to (`youtube.com:watch:darken-page-except-video-player`) and run later by typing `/`. The code stays in the browser; no MCP client can reach it
- **Voice, Text, or Demonstration**: Dictate in the side panel, type anywhere, or record yourself doing a job once and later say "do it like last time"
- **Point at What You Mean (A-Eye)**: Press the lens, hover the page, click the thing — the element and its content ride along with your next message, and the agent can hand the lens back when *it* needs you to pick
- **Hand It a File**: Drop a CSV, a log or — on Claude Code — a PDF or a screenshot on the panel, and a separate, short-lived session of your agent reads it and writes a report into that conversation. An archive, a program or anything over 10 MB is turned away with the reason before any agent starts
- **Teach It a Site Once**: Point it at a site and it explores and writes reusable notes, so every later session already knows its way around
- **Instant Commands**: "Go back", "scroll to the top", "open github.com" run in the browser in milliseconds instead of becoming an agent round trip
- **Guardrails, Not Vibes**: A declarative policy gates consequential actions, confines each run to the sites it is about, and marks every byte of page text as untrusted data — tunable per rule from a Settings tab, with nothing overridden until you say so
- **Off By Default**: A fresh install contacts nothing until you redeem a one-time pairing code

## How It Works

![How an instruction becomes a click](https://browsentic.com/flow.png)

<details>
<summary>The same flow, as text</summary>

```
You ──speak or type──> Extension ──local WebSocket──> Daemon ──spawns──> your agent CLI
                            ▲                              (claude │ codex │ agy │ vibe │ grok)
                            └──────────────── page actions ─────────────────────┘

Any MCP client ──stdio──> browsentic mcp ──> the same daemon ──> the same browser
```

</details>

The extension dials out to the daemon, because a Manifest V3 service worker cannot listen for connections. One daemon owns the browser link, so several MCP clients can share one browser. Everything binds to `127.0.0.1`.

## Resources

- 📚 [Documentation](docs/)
- 🚀 [Install and Pair](docs/guide/install.md)
- ✨ [Features](docs/guide/features/)
- 🧰 [All 52 Page Tools](docs/reference/tools.md)
- 🔌 [Optional: Drive It From Claude Code, Cursor or Zed Over MCP](docs/guide/mcp-clients.md)
- 🛡️ [Approvals and Guardrails](docs/guide/approvals.md)
- 🏗️ [Architecture](docs/internals/)
- 🩺 [Troubleshooting](docs/guide/troubleshooting.md)

## Privacy and Security

Nothing connects until you pair, both ends prove themselves, consequential actions ask first, and credentials on a page are sealed before the agent sees them. The full model is in [SECURITY.md](SECURITY.md), and what it does not cover is in [Limits](docs/guide/limits.md).

## Contributing

Bugs and ideas are welcome — start at [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Browsentic is MIT licensed.

- **Source Available**: Always visible source code
- **Local First**: No cloud component, no telemetry, no account
- **Extensible**: Add your own page capabilities, skills and agent runners

## What does Browsentic mean?

**Short answer:** "Browse" + "agentic".

**Long answer:** Most browser automation asks you to hand the work to a *different* browser — a headless one, in a container, logged in to nothing. Browsentic is the other way round: the agentic part happens in the browser you are already looking at, with the sessions you are already signed in to. The name is the thesis — browsing, made agentic, where you already browse.
