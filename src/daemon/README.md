# browsentic

Hand your real, logged-in browser to the AI agent you already run.

Browsentic is a browser extension plus a local daemon. The extension opens a side panel beside
whatever tab you are on; the daemon runs on loopback and wakes the agent CLI you already have
installed. There is no hosted relay, no API key, and no headless browser — it drives the tab you
are already signed in to.

This package carries both halves: the daemon, and the extension build that `browsentic setup`
installs onto disk.

## Install

```sh
npx browsentic setup
```

That installs the extension, starts the daemon and prints a pairing code. Two steps are left, and
both happen inside the browser, so only you can do them:

1. Open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked**, and choose the
   folder the command printed (`~/browsentic/extension/chrome-mv3`).
2. Open the Browsentic popup and paste the pairing code.

Then open the side panel and say what you want.

To update later:

```sh
npx browsentic@latest update
```

The extension installs to a stable path on purpose, so an update keeps the same extension ID and
your browser stays paired. Press ↻ on the Browsentic card afterwards to pick up the new build.

## Requirements

- Node.js 20 or newer
- Chrome, or another Chromium browser
- One agent CLI on your `PATH`: `claude`, `codex` or `agy`

## Commands

| | |
| --- | --- |
| `browsentic setup` | install the extension, start the daemon, print a pairing code |
| `browsentic update` | refresh the installed extension and restart the daemon |
| `browsentic pair` | issue a fresh single-use code |
| `browsentic status` | daemon, extension and agent state |
| `browsentic sessions` | list paired browsers |
| `browsentic revoke` | unpair one browser, or all of them |
| `browsentic agent` | choose which agent runs the side panel |
| `browsentic logs` | tail the daemon log |
| `browsentic mcp` | serve MCP over stdio |

`browsentic help` lists the rest.

## Using it from an MCP client

Optional. The side panel needs none of this — it is for people who would rather drive the browser
from a terminal.

```sh
npm i -g browsentic
claude mcp add browsentic -- browsentic mcp
```

Any MCP client works: Claude Code, Codex, Cursor, Zed, Claude Desktop. One daemon owns the browser
link, so several can share the same paired browser at once.

Prefer a global install over `npx` here. An `npx` command re-resolves on every client start and can
quietly pull a newer daemon than the extension you have loaded.

## Documentation

Full documentation lives at **[browsentic.com/docs](https://browsentic.com/docs/)**, including the
[security model](https://browsentic.com/security/), the
[tool reference](https://browsentic.com/docs/reference/tools/) and the
[architecture](https://browsentic.com/docs/internals/).

Source: [github.com/imshaikot/browsentic](https://github.com/imshaikot/browsentic) · MIT
