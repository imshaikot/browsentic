---
layout: layouts/doc.njk
pageKey: docs
title: "Pair your browser"
seoTitle: "Pair your browser — Browsentic user guide"
description: "A fresh install connects to nothing. Pairing is what tells the daemon that this browser is yours. Assumes you have installed and loaded the extension."
deck: "A fresh install connects to nothing. Pairing is what tells the daemon that this browser is yours."
docsPath: "guide/pair.md"
section: "guide"
sectionLabel: "User guide"
sectionOrder: 1
order: 1
isIndex: false
permalink: "/docs/guide/pair/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/pair.md"
---
Assumes you have [installed and loaded the extension](/docs/guide/install/).

---

## 1. Put the CLI on your PATH

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

If the command is not found, your global npm prefix is not on `PATH`. Find it with `npm prefix -g`
and add its `bin` directory.

## 2. Redeem a pairing code

```sh
browsentic-mcp pair
```

This starts the daemon if it is not already running and prints a code:

```
  Pairing code:  K7QM-3XPT

  Open the Browsentic popup, paste it, and press Connect.
  Expires in 10 minutes and works once.
```

Open the Browsentic popup, paste the code, press **Connect**.

The daemon issues a long-lived session key that survives browser and daemon restarts, and dies only
when you revoke it. You do not need to pair again after an update.

## 3. Verify

```sh
browsentic-mcp status
```

```
daemon:    running on 127.0.0.1:8765 (pid 41207, v0.2.1)
extension: connected (v0.2.1)
manifest:  in sync
paired:    1
```

All four lines matter:

| Line | What it means |
| --- | --- |
| `daemon` | The local process is up, on one of ports 8765–8767 |
| `extension` | Your browser is connected right now. `offline` means the browser is closed or unpaired |
| `manifest` | `in sync` means both halves were built from the same action registry. `DRIFTED` means [rebuild both](/docs/guide/maintenance/) |
| `paired` | How many browsers hold a session key |

---

## What pairing actually protects

Worth understanding, because it is easy to assume it does more than it does.

Any web page can open a WebSocket to loopback, so the daemon classifies every connection by its
handshake `Origin` — a value browsers set themselves and page JavaScript cannot forge. A web page
is refused outright. An extension origin must then prove it holds a pairing code or a session key,
and the daemon proves itself back, so another local process cannot squat the port and pose as your
daemon. Neither secret ever crosses the wire.

What pairing does **not** do is authenticate local programs. Anything running as your user can read
`~/.browsentic/daemon.json` and drive an already-paired browser. Browsentic treats your user account
as the trust boundary. See [Limits](/docs/guide/limits/#pairing-controls-which-browser-not-which-process) and,
for the mechanism, [internals/transport.md](/docs/internals/transport/).

---

## Managing pairings

```sh
browsentic-mcp sessions          # which browsers are paired
browsentic-mcp revoke            # unpair every browser
browsentic-mcp revoke <origin>   # unpair one
```

Several browsers can be *paired*, but the daemon keeps **one live link** at a time — a newer
connection supersedes the old one.

---

## Next

**[First run →](/docs/guide/first-run/)** — open the side panel and give it something to do.

Driving the browser from Claude Code, Cursor or another MCP client instead? That is a separate
registration step: [MCP clients](/docs/guide/mcp-clients/).
