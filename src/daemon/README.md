# browsentic

This is **Browsentic Bridge**, the half of Browsentic that runs on your computer.

Browsentic is your browser's superpower: a side panel that drives your real, logged-in browser with
the AI agent you already use. The extension opens the panel beside whatever tab you are on; the
Bridge runs on loopback and wakes the agent CLI you already have installed. It is free and open
source, with no hosted relay, no API key, no account and no headless browser — it drives the tab you
are already signed in to.

## Install

Browsentic is two pieces plus the AI you already use:

1. **The extension**, in your browser: from the
   [Chrome Web Store](https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp)
   for Chrome, Edge, Brave, Arc, Vivaldi and Opera, or the
   [signed add-on](https://browsentic.com/download/firefox) for Firefox.
2. **Browsentic Bridge**, this package:

   ```sh
   npx browsentic@latest setup
   ```

   It starts the Bridge, asks which browser should get the extension, opens its store page there,
   prints a pairing code and waits for the browser to connect. On macOS and Windows an app does the
   same from a window: see [browsentic.com/install](https://browsentic.com/install/).
3. **An agent CLI you're signed in to**: Claude Code, Codex, or another supported one.

Click Browsentic in the toolbar, enter the pairing code once, then open the side panel and say what
you want.

To update later:

```sh
npx browsentic@latest update
```

The extension updates itself from its store, and the two don't have to be the same version.

## Requirements

- Node.js 20 or newer
- Chrome, Edge, Brave, Arc, Vivaldi, Opera or another Chromium browser, or Firefox 140 or newer
- One agent CLI on your `PATH`, logged in: `claude`, `codex`, `agy`, `vibe`, `grok`, `cursor-agent`,
  `qwen` or `opencode`

## Commands

| | |
| --- | --- |
| `browsentic setup` | start the Bridge, add the extension to a browser and pair it |
| `browsentic update` | update the Bridge and restart it |
| `browsentic browsers` | the browsers on this computer and where each gets the extension |
| `browsentic pair` | issue a fresh single-use code |
| `browsentic status` | the Bridge, each paired browser and the agent |
| `browsentic sessions` | list paired browsers |
| `browsentic revoke` | unpair one browser, or all of them |
| `browsentic agent` | choose which agent runs the side panel |
| `browsentic logs` | tail the Bridge's log |
| `browsentic mcp` | serve MCP over stdio |

`browsentic help` lists the rest. A browser that cannot reach a store can load the extension from
a folder this package carries: `browsentic setup --unpacked`.

## Using it from an MCP client

Optional. The side panel needs none of this — it is for people who would rather drive the browser
from a terminal.

```sh
npm i -g browsentic
claude mcp add browsentic -- browsentic mcp
```

Any MCP client works: Claude Code, Codex, Cursor, Zed, Claude Desktop. One Bridge owns the browser
link, so several can share the same paired browser at once.

Prefer a global install over `npx` here. An `npx` command re-resolves on every client start and can
quietly start a different Bridge than the one you set up.

## Documentation

Full documentation lives at **[browsentic.com/docs](https://browsentic.com/docs/)**, including the
[security model](https://browsentic.com/security/), the
[tool reference](https://browsentic.com/docs/reference/tools/) and the
[architecture](https://browsentic.com/docs/internals/).

Source: [github.com/imshaikot/browsentic](https://github.com/imshaikot/browsentic) · Apache 2.0
