# Pair your browser

Pairing connects the extension in one browser to Browsentic Bridge, once per browser. With the
Bridge on your computer, the extension pairs by itself: no code to copy. This page covers how that
works, how to make it ask you first or turn it off, how to pair with a code, what pairing protects
and managing several paired browsers.

It assumes you have [added the extension and installed the Bridge](install.md).

---

## 1. It connects by itself

Install the extension and Browsentic Bridge, in either order. The extension finds the Bridge through
the browser's native messaging host, which `setup` and the apps register, and the two connect. The
extension tries when it is installed, when the browser starts, when you open the side panel, and
every minute or so while it is not paired, more slowly when there is nothing to find.

The Bridge then issues a long-lived session key that survives browser and Bridge restarts and lasts
until you revoke it. Updating either side does not need a new pairing.

An extension from before automatic pairing, or a Bridge from before it, still pairs with a code
(section 3).

## 2. Choose how browsers pair

```sh
browsentic pairing          # show how browsers pair now
browsentic pairing auto     # by themselves (the default)
browsentic pairing ask      # once you allow each one
browsentic pairing code     # only with a code
```

The apps' Settings tab has the same three choices. The extension shows the setting but cannot
change it, because the browser is what the setting guards.

**Ask** shows each new browser to you before it connects:

- **With the Mac or Windows app,** a notification and a sheet in the app say which browser asks:
  its name, where its extension came from and its version. Press **Allow**, and give it a name if
  you like ("Work Chrome"). If the app is closed, the Bridge starts it in the background.
- **Without an app,** run `browsentic approve` (or `browsentic approve --watch` to be asked about
  each one as it comes), or answer the prompt `browsentic setup` shows while it waits.
- `browsentic requests` lists the browsers waiting, and `browsentic deny <id>` turns one down.

An allowed browser pairs by itself from then on. A denied one stays out until someone presses
**Reconnect** in that browser and you allow it.

**Code** pairs nothing by itself, and is also the switch to reach for if you ever want automatic
pairing off at once.

## 3. Pair with a code

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

  Open the Browsentic side panel, paste it, and press Connect.
  Expires in 10 minutes and works once.
```

Click Browsentic in the toolbar to open the side panel, then the status pill (or **Set up the link**
in the empty chat), press **Pair with a code instead**, enter the code and press **Connect**. In the
apps, **Get a pairing code** does the same. Up to three codes are live at once, so a code the app
shows keeps working while a terminal mints another.

A code always works, whatever `pairing` is set to: use it for a browser the Bridge cannot register
with (section 6), a managed browser whose policy blocks native messaging, or an extension from
before automatic pairing.

## 4. Verify

```sh
browsentic status
```

```
bridge:    running on 127.0.0.1:8765 (pid 41207, v0.9.0)
wake-up:   Chrome, Brave can start the Bridge
agent:     Claude Code — 2.1.0 (Claude Code)
browsers:
  ● Google Chrome    v0.9.0    Chrome Web Store  connected
  ○ Brave            v0.9.0    Chrome Web Store  not connected
tools:     in sync
pairing:   automatic: a browser with Browsentic connects by itself
```

| Line | What it means |
| --- | --- |
| `bridge` | The local process is up, on one of ports 8765–8767 |
| `wake-up` | Which browsers can start the Bridge, and pair, when it is down |
| `agent` | The CLI the side panel runs on, and whether it is ready |
| `browsers` | One row per paired browser: its extension version, where the extension came from, and whether it is connected right now. An unpacked copy a build behind the folder on disk says to press ↻; a store copy updates itself. Two copies answering in one browser are flagged |
| `tools` | `in sync` means both halves were built from the same action registry. When the extension is a version ahead or behind, the tools come from the extension, which is fine |
| `pairing` | How a new browser pairs (section 2) |

`browsentic sessions` also says how each browser paired: by itself, allowed, or with a code.

---

## What pairing protects, and what it does not

Any web page can open a WebSocket to loopback, so the Bridge classifies every connection by its
handshake `Origin`, which browsers set themselves and page JavaScript cannot forge. A web page is
refused outright. An extension origin must then prove it holds a pairing code, a one-time grant or a
session key, and the Bridge proves itself back, so another local process cannot squat the port and
pose as your Bridge. No secret ever crosses the socket.

Automatic pairing asks for its grant through the browser's native messaging host, which the browser
launches only for Browsentic's own extensions: the Chrome Web Store and Edge Add-ons copies by their
IDs, the unpacked folder, and the signed Firefox add-on, in a browser running as you. Web pages
cannot reach it. A grant works once, for two minutes, for that one browser profile and the extension
origin the browser vouched for, and a grant handed out is taken back the moment the setting changes
to code or the browser is revoked.

What that leaves: someone at your keyboard who loads a copy of the extension that claims
Browsentic's ID (Developer mode in Chromium, a temporary add-on in Firefox) is paired by itself in
`auto` mode. In `ask` mode you see it and can deny it. A program running as you could always read
the Bridge's control token anyway.

What pairing does **not** do is authenticate local programs. Anything running as your user can read
`~/.browsentic/daemon.json` and drive an already-paired browser. Browsentic treats your user account
as the trust boundary. See [Limits](limits.md#pairing-controls-which-browser-not-which-process) and,
for the mechanism, [internals/transport.md](../internals/transport.md).

---

## Managing pairings

```sh
browsentic sessions                 # which browsers are paired, and which are kept out
browsentic rename <id> "Work Chrome"   # name one
browsentic revoke                   # unpair every browser
browsentic revoke <id>              # unpair one, by the id "sessions" prints
browsentic approve <id>             # let a revoked or denied browser back in
```

Revoking a browser also keeps it from pairing again by itself, so it does not come back a minute
later. It returns when you press **Reconnect** in that browser (in `auto` mode), or pair it with a
code. In `ask` mode, allow it in the app or with `browsentic approve <id>` as well; either way the
browser connects once you press **Reconnect** in it. **Disconnect** in the extension does the
same from the browser's side: it stays unpaired until you press **Connect** there.

Several browsers can be paired **and connected at once**: Chrome beside Brave, or two Chrome
profiles. Each keeps its own key, and the side panel in each runs on its own. Every browser that
installs from the same store, or loads the same folder, presents the same extension origin, so a
browser is known by an install id it mints on first run, never by its origin.

A newer connection supersedes an older one only when both come from the same browser profile.

An optional MCP client outside the browser reaches the browser you were last in. It stays with that
browser through a burst of calls, because tab ids only mean something in the browser that issued
them, and follows you again once it has been quiet for two minutes. `browsentic_status` names the browser it reaches.

---

## 5. When it does not connect by itself

The side panel's **Connection** sheet and the welcome page say why. The usual reasons:

| It says | What to do |
| --- | --- |
| Browsentic Bridge isn't on this computer yet | Install it (the Mac or Windows app, or `npx browsentic@latest setup`). Already installed? Open the app or run `browsentic setup`, which registers this browser |
| Browsentic Bridge needs an update | `npx browsentic@latest update`, or **Update now** in the app |
| Allow this browser in the Browsentic app | `pairing` is `ask`: press **Allow** in the app, or run `browsentic approve` |
| This computer disconnected this browser | It was revoked. Press **Reconnect** |
| Automatic pairing is off on this computer | `pairing` is `code`: pair with a code, or run `browsentic pairing auto` |
| Your organization's browser policy keeps Browsentic Bridge from starting | Pair with a code |
| Browsentic Bridge is turned off | `browsentic start`, or turn it on in the app |

## 6. Browsers it registers with

`setup`, the apps and every Bridge start register the native host where each installed browser
reads it. On macOS and Windows they also always register it in Chrome's and Mozilla's locations,
since Brave, Opera and other forks read Chrome's. On macOS, a Chromium fork no list names is found from its app's `Info.plist`.

Registered: Chrome and its Beta, Dev and Canary channels, Edge and its channels, Brave, Vivaldi,
Arc, Opera, Opera GX, Comet, Thorium, Chromium, Firefox and its channels, Zen, LibreWolf, Waterfox
and Floorp. Tor Browser is left out on purpose. A browser installed after setup is registered the
next time the Bridge starts, or within the hour while it runs. Orion's native messaging does not
work, and a Snap or Flatpak browser on Linux cannot run the host: pair those with a code.

---

## Next

**[First run →](first-run.md)**: a tour of the side panel and a first instruction to try.

Driving the same browser from Claude Code, Cursor or another MCP client is optional and takes a
separate registration step: [MCP clients](mcp-clients.md).
