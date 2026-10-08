# browsentic

This is **Browsentic Bridge**, the half of Browsentic that runs on your computer.

Browsentic is your browser's superpower: an agentic browser harness that runs the agent CLI you
already use from a side panel in your real, logged-in browser. The side panel opens beside whatever
tab you are on; the Bridge runs on loopback and starts your agent CLI when you give it work. It is
free and open source, with no hosted relay, no API key, no account and no headless browser: the
agent works in the tabs you are already signed in to.

## Install

One command sets everything up, the extension included:

```sh
npx browsentic@latest setup
```

It starts Browsentic Bridge, asks which browser you use, opens the extension's store page there,
prints a pairing code and waits for the browser to connect. Press **Add to Chrome** (**Get** in
Edge, **Add** in Firefox), click Browsentic in the toolbar and enter the code, once. On macOS and Windows an app does
the same from a window: see [browsentic.com/install](https://browsentic.com/install/).

The extension is on the
[Chrome Web Store](https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp)
for Chrome, Brave, Arc, Vivaldi and Opera, on
[Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/browsentic/cbkjhkgjcpihokphhdkbahilpcjojpdc)
for Edge, and Firefox gets an [add-on signed by Mozilla](https://browsentic.com/download/firefox).
The side panel runs on an agent CLI you are signed in to: Claude Code, Codex, or another supported
one.

Then open the side panel and type or speak an instruction.

To update later:

```sh
npx browsentic@latest update
```

The extension updates itself from its store, and the two do not have to be the same version.

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

Optional, and the side panel needs none of it. Registering Browsentic with an MCP client lets that
client drive the same browser from a terminal.

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
