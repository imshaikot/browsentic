# Pair your browser

A fresh install connects to nothing. Pairing is what tells Browsentic Bridge that this browser is
yours, and you do it once per browser.

Assumes you have [added the extension and installed the Bridge](install.md).

---

`browsentic setup` and the apps already showed a code, and you may have used it. This page is what
to do when you need another one, or when you are pairing a second browser.

---

## 1. Redeem a pairing code

```sh
browsentic pair
```

Through `npx`, if you have not installed the command globally:

```sh
npx browsentic pair
```

This starts the Bridge if it is not already running and prints a code:

```
  Pairing code:  K7QM-3XPT

  Open the Browsentic popup, paste it, and press Connect.
  Expires in 10 minutes and works once.
```

Click Browsentic in the toolbar, enter the code, press **Connect**. In the apps, **Get a pairing
code** on the Overview tab does the same. Up to three codes are live at once, so a code the app shows
keeps working while a terminal mints another.

The Bridge issues a long-lived session key that survives browser and Bridge restarts, and dies only
when you revoke it. You do not need to pair again after an update, on either side.

## 2. Verify

```sh
browsentic status
```

```
bridge:    running on 127.0.0.1:8765 (pid 41207, v0.8.0)
wake-up:   Chrome, Brave can start the Bridge
agent:     Claude Code — 2.1.0 (Claude Code)
browsers:
  ● Google Chrome    v0.8.0    Chrome Web Store  connected
  ○ Brave            v0.8.0    unpacked          not connected
tools:     in sync
```

Every line matters:

| Line | What it means |
| --- | --- |
| `bridge` | The local process is up, on one of ports 8765–8767 |
| `wake-up` | Which browsers can start the Bridge when it is down |
| `agent` | The CLI the side panel runs on, and whether it is ready |
| `browsers` | One row per paired browser: its extension version, where the extension came from, and whether it is connected right now. An unpacked copy a build behind the folder on disk says to press ↻; a store copy updates itself. Two copies answering in one browser are flagged |
| `tools` | `in sync` means both halves were built from the same action registry. When the extension is a version ahead or behind, the tools come from the extension, which is fine |

---

## What pairing actually protects

Worth understanding, because it is easy to assume it does more than it does.

Any web page can open a WebSocket to loopback, so the Bridge classifies every connection by its
handshake `Origin` — a value browsers set themselves and page JavaScript cannot forge. A web page
is refused outright. An extension origin must then prove it holds a pairing code or a session key,
and the Bridge proves itself back, so another local process cannot squat the port and pose as your
daemon. Neither secret ever crosses the wire.

The browser can also start the Bridge when it is down, through a native messaging host that setup
registers with each browser. Only Browsentic's own extensions may launch it: the Chrome Web Store
and Edge Add-ons copies by their IDs, the unpacked folder, and the signed Firefox add-on. It starts
the Bridge and nothing more; it pairs nothing.

What pairing does **not** do is authenticate local programs. Anything running as your user can read
`~/.browsentic/daemon.json` and drive an already-paired browser. Browsentic treats your user account
as the trust boundary. See [Limits](limits.md#pairing-controls-which-browser-not-which-process) and,
for the mechanism, [internals/transport.md](../internals/transport.md).

---

## Managing pairings

```sh
browsentic sessions          # which browsers are paired
browsentic revoke            # unpair every browser
browsentic revoke <id>       # unpair one, by the id "sessions" prints
```

Several browsers can be paired **and connected at once** — Chrome beside Brave, or two Chrome
profiles. Each pairs with its own code and keeps its own key, and the side panel in each runs on its
own. Every browser that installs from the same store, or loads the same folder, presents the same
extension origin, so a browser is known by an install id it mints on first run, never by its origin.

A newer connection supersedes an older one only when both come from the same browser profile.

An MCP client outside the browser reaches the browser you were last in. It stays with that browser
through a burst of calls — tab ids only mean something in the browser that issued them — and follows
you again once it has been quiet for two minutes. `browsentic_status` names the browser it reaches.

---

## Next

**[First run →](first-run.md)** — open the side panel and give it something to do.

Want to also drive the browser from Claude Code, Cursor or another MCP client? That is optional,
and a separate registration step: [MCP clients](mcp-clients.md).
