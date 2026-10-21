# Transport and authorization

How the extension and local clients (the CLI, MCP servers, the desktop apps) connect to the daemon
over loopback, and how each side proves it is allowed to.

![The origin gate refusing a web page, then the mutual pairing handshake](../assets/transport.png)

[The same sequence, animated →](../assets/transport.gif)

---

## One server, three ports

The daemon runs one HTTP server that answers `GET /health` and upgrades everything else to a
WebSocket. It binds the first free port of **8765, 8766, 8767**. If all three are taken it will not
start.

`BROWSENTIC_PORTS` replaces that list for the daemon and the CLI: comma-separated, with `0` for
whatever port the OS hands out. The test suite sets it so a test daemon never takes a port from the
one you are running. The extension cannot read it and always walks the three, so no browser will find
a daemon moved off them.

---

## The origin gate

Every upgrade is classified by the handshake `Origin` header before anything else happens:

| `Origin` | Role | Requirement |
| --- | --- | --- |
| `chrome-extension://…`, `moz-extension://…`, `safari-web-extension://…` | `extension` | Proof of a pairing code, or of the session key minted for that browser's install id |
| Any other value | (none) | **Refused.** This is what keeps web pages out |
| Absent | `control` | `Authorization: Bearer <token>` matching the lockfile, compared with `timingSafeEqual` |

Every request, `/health` included, must also carry a loopback `Host`. A page whose own DNS points at
`127.0.0.1` still arrives with the attacker's hostname, so **DNS rebinding gets a 403 before the
`Origin` check even runs**.

The split matters because any web page can open a WebSocket to loopback. Browsers set `Origin`
themselves and page JavaScript cannot forge it, so a page reaching the daemon is classified as a web
origin and rejected outright. Native clients send no `Origin`, so they land in the control lane,
which requires a token they could only have read off the local filesystem.

So there are two independent gates: **the origin says what kind of peer this is, and the credential
says whether this particular peer is allowed.**

---

## The control token

24 random bytes, base64url, minted fresh by **each** daemon and written to
`~/.browsentic/daemon.json` at mode `0600`. It dies with the daemon that issued it, so a token that
leaked once does not open every future daemon.

Clients re-read the lockfile before every connection, and `probeExisting()` matches the pid in
`/health` against the lockfile so it never offers a token to a daemon that never issued it.

Read it with `browsentic token`.

---

## Pairing and sessions

The extension connects to nothing until it is paired, by a code someone types or by a grant the
native host hands over (next section). Both go through the same handshake.

1. `browsentic pair` asks the daemon for a code: 8 characters from an alphabet with the
   ambiguous glyphs removed, valid **10 minutes**, single use.
2. You paste it into the side panel (status pill → **Connection**) and press **Connect**. The
   extension dials `ws://127.0.0.1:<port>/extension`, walking the three ports, and sends `hello`,
   which names *which* secret it holds and carries a fresh nonce, never the secret itself.
3. The daemon answers `challenge` with a nonce of its own. Both sides now share a transcript: the
   protocol version the `hello` claimed, the extension version, the manifest hash, and the two
   nonces. The manifest hash names the tool list this build offers: a Chromium build's, or a Firefox
   build's, which leaves off the nine tools that need Chrome's debugger. The daemon knows both lists
   and serves the one the hash names; an unknown hash is a drifted build, which is asked for its list
   and served that. Either way the list belongs to that browser alone: a run is offered its own
   browser's tools, and a caller outside any run is offered those of the browser its next call would
   reach.
4. The extension replies `prove` with `HMAC(secret, "browsentic/client" ‖ transcript)`. For a
   pairing code the key is not the code but `PBKDF2(code, nonces, 250 000)`, so recording one
   handshake does not let anyone grind an 8-character code offline.
5. The daemon verifies, then proves *itself*: `welcome` carries
   `HMAC(secret, "browsentic/server" ‖ transcript ‖ the rest of the welcome)`. The two labels are
   distinct, so an impostor cannot reflect the extension's own proof back at it.
6. On pairing, the daemon mints a **session key** (32 random bytes) bound to the **install id** the
   `hello` carried: a UUID the extension mints once per browser profile. The origin cannot name a
   browser, because every browser installing from the same store, or loading the same unpacked
   folder, presents the same one. A session paired before install ids existed is found by its
   origin and claimed by whichever browser proves its key. The daemon returns the key XORed with a
   keystream derived from the same secret, so the long-lived credential never crosses the wire in
   the clear. It survives browser and daemon restarts and dies only when you `browsentic revoke`.

### Pairing by itself: grants

`answerNativeMessage()` in `native-messaging.ts` answers three ops, one message per launch:

| Op | Answer |
| --- | --- |
| `ensure` | Starts the Bridge. Byte for byte what 0.8.x answered, because shipped extensions read it |
| `hello` | The host version, its ops, `pairing.mode`, whether the Bridge is held, whether a desktop app is installed. Read from disk; never starts the Bridge |
| `pair` | A grant, a `wait`, a refusal (`off`, `revoked`, `denied`, `stopped`, `origin`, `restart`) or an error |

Anything else gets `Expected {"op":"ensure"}.`, which is how a new extension recognises a host that
predates pairing.

1. The browser launches the host only for the extension IDs its registration lists, and passes the
   caller: `chrome-extension://<id>/` from Chromium (with `--parent-window` on Windows), the add-on
   ID from Firefox. `callerOf()` reads it from anywhere in argv; a caller it cannot name gets
   `origin` and nothing else.
2. The host asks the Bridge over `/control` (`grant`). `pairing-desk.ts` answers by
   `pairing.mode`: `code` refuses, a blocked install id is refused unless the request was a click
   (`gesture`), `ask` holds a request until an approver allows it, and otherwise it mints a
   **grant**: 26 characters from the code alphabet, valid **120 s**, single use, bound to the
   install id and the caller (the exact origin for Chromium; the `moz-extension://` scheme for
   Firefox, whose socket origin is a random UUID per install). Grants live in memory only. A second
   ask hands back the same grant while more than 30 s of it remains, and never takes a slot from
   the three typed codes.
3. The extension redeems the grant with the same `pair` hello and PBKDF2 proof a typed code uses,
   dialling the grant's port first. `greet()` tries the grant held for that install id from that
   origin before the typed codes, and checks it again then: a mode switched to `code`, a revoke or a
   withdrawn approval since it was handed out takes it back.
4. The session records `pairedBy`: `auto`, `approved` or `code`.

**Ask mode.** A request is one per install id, kept in memory for 10 minutes after its last ask,
with a nonce the app checks before a `browsentic://` link may act on it. Control clients that send
`pairRequests {watch:true}` are approvers and hear `pair-requests-changed`. If no app is watching but
the app marker names one, the Bridge starts it in the background, once per request. `decide` allows
(which also lifts a block and is remembered in `auth.json`'s `approved`) or denies (a `denied`
block). A host may hold a `pair` open for up to 25 s (`waitMs`) so an open page hears the decision
at once: a pending `sendNativeMessage` keeps a Chromium service worker alive and blocks a Firefox
background page's suspension.

**Blocks.** `revoke` deletes the session and blocks the install id (`auth.json`'s `blocked`, the newest
200 kept), so the extension's next automatic attempt is refused rather than re-pairing it. A click
in that browser (in `auto` mode), `decide`, or a typed code lifts it. Agent-run connections
(`speaksForRun`) are refused `grant`, `decide`, `pairing` changes and `label`.

**A Bridge older than grants** never answers an op it does not know, so the host reads `status`
first: one without `pairing` gets a plain code from `pair` in `auto` mode, and `restart` in `ask`
mode, where nobody could be asked.

### Refusal codes

An `unauthorized` frame carries `code` beside the `reason` text, which stays as shipped:

| Code | Meaning | What the extension does |
| --- | --- | --- |
| `bad-code` | A code or grant that matched nothing | Reports it |
| `unknown` | A session key the Bridge holds no session for, and the install is not blocked: a wiped or reinstalled Bridge | Marks the key stale and pairs again through the host, keeping the old key until a new one is stored |
| `revoked` | A key for a browser this computer revoked | Marks the key stale and waits for **Reconnect** |

### Why the daemon proves itself too

The three ports are well known and any local process can bind one first, so an extension that
trusted whatever answered could be driven by a squatter.

So a socket that closes without a **verified** `welcome` (a squatter, a daemon from an older
protocol, an `unauthorized` frame, five seconds of silence) is abandoned, and the walk moves to the
next port. Only a peer that proves it holds the same secret ever gets to send an `invoke`.

### Reconnection

Exponential backoff from 1 s to 30 s with jitter, plus a one-minute `browser.alarms` tick that
re-dials if the service worker was torn down in between.

A rejected `hello` comes back as an `unauthorized` frame carrying a `retryable` flag. Nothing has
proved itself at that point, so the extension treats it as a **claim rather than a verdict**: it
notes the reason, tries the remaining ports, and if none work it reports the error and stops
dialling. It never deletes the stored key; only pairing again or `disconnect` replaces it.

---

## Protocol version

Both sides compile in `SOCKET_PROTOCOL_VERSION` (currently **25**). They used to have to match
exactly. A store copy updates when its browser decides to, not when the daemon does, so the
extension and the daemon are routinely a version apart, and the daemon accepts a **window**:

- It lets in any extension whose `hello` claims `MIN_EXTENSION_PROTOCOL` (22) or more, newer than
  itself included, and builds the transcript from the number the `hello` claimed, so the proofs
  verify across versions. Older ones are refused with `protocol version mismatch: …`, the words an
  extension before 0.8 already reads as a refusal not worth retrying.
- A `hello` may carry `minDaemonProtocol`, the oldest daemon that extension works with. A daemon
  below it refuses with `daemon too old: …`.
- `welcome` carries the daemon's own `protocolVersion`, so a newer extension knows what not to
  send. A `welcome` without one comes from a daemon before 0.8, which speaks 22 or less.

**The rule for changing it.** A change a peer can do without (a new frame, a new optional field)
bumps `SOCKET_PROTOCOL_VERSION`, and the new frame is sent only to a peer whose `hello` (or
`welcome`) says it speaks that number. Anything the daemon does not know, it leaves unanswered. Only
a change neither side can do without raises a minimum. A refusal must never strand a browser: the
v0.8.0 store build unpairs on any refusal and does not retry, so no daemon may refuse protocol 22
until a store build that retries has replaced it.

### Protocol 25: an agent the extension does not know

An extension looks every agent up by its kind, so one built before an agent was added cannot show
it. `AGENT_PROTOCOL` names the first protocol whose extension knows each agent added since the window
opened; for DeepSeek Harness that is 25. An extension below it is never sent that agent: its agent
list leaves it out, and while it is the chosen agent a run started there is refused with
`AGENT_UNUSABLE`, *DeepSeek Harness needs a newer Browsentic extension*.

### Protocol 24: notices for the desktop app

Protocol 24 lets a browser hand a finished monitor, scheduled task or reminder to the Browsentic app,
which shows it as the computer's own notification. The extension does this only while no browser
window is focused and un-minimized (`browserInFront()` in `device-notices.ts`), and only to a Bridge
that speaks 24; the Bridge sends `openNotice` only to an extension that speaks 24.

| Frame | From | What it carries |
| --- | --- | --- |
| `notice` | extension | `id` for the answer and the notice: its own `id`, `kind` (`monitor`, `task`, `timer`), `title`, `body` and `tone`. It does not count as the user being in that browser |
| `noticeAck` | Bridge | `delivered`: whether an app that may show notifications took it. False, or no answer within 3 s, and the extension shows its own card or notification |
| `openNotice` | Bridge | `noticeId`: someone clicked it in the app, so the extension brings that notice's tab to the front |

The app sends `/control` `notices {watch:true, allowed}` on every socket and again when the
computer starts or stops letting it notify (`watch:false` lets go); `notices-changed` tells it to
call `takeNotices`, which hands over and forgets what is waiting (a notice nobody takes within five
minutes is dropped). Only a watcher that said `allowed` is told, and only it is handed anything. A click
sends `openNotice`, which reaches the browser the notice came from. Agent-run connections are refused
all three. Nothing about a notice is written to disk.

### Protocol 23: Android

Protocol 23 adds the frames that let a browser drive Chrome on an Android phone through the Bridge.
The Bridge keeps the number each extension's `hello` claimed and sends these frames only to an
extension that speaks 23. The extension keeps the number the `welcome` carried (`daemonSpeaks`) and
sends them only to a Bridge that speaks 23. An extension that speaks 22 is never sent one, and a
phone request from it is answered `UNSUPPORTED`. The shapes are in `src/lib/phone/types.ts`.

| Frame | From | What it carries |
| --- | --- | --- |
| `androidInfo` | Bridge | The phones and whether one is ready (`AndroidState`). Pushed with an empty `id` on connect and on every change, and the answer to `phoneLaunch` |
| `phoneOpen` | extension | `serial`: start a session with Chrome on that phone. Answered by `phoneOpened` |
| `phoneOpened` | Bridge | The device, its open tabs and Chrome's version, or an error |
| `phoneClose` | extension | `serial`: end the session. Not answered |
| `phoneLaunch` | extension | `serial` and an optional `url`: open Chrome on the phone |
| `cdp` | extension | One DevTools command for the phone's Chrome: `method`, `params`, `sessionId`, and `timeoutMs` (at most 180 s) when the command waits inside the page. Answered by `cdpResult` |
| `cdpResult` | Bridge | Chrome's result, or `CDP_ERROR`, `TIMEOUT`, `PHONE_GONE` or `NOT_OWNER` |
| `cdpEvent` | Bridge | Every DevTools event from the phone, screencast frames included, sent only to the extension that opened the session. A screencast frame that finds the socket more than 4 MB behind is dropped and acknowledged to the phone, so the stream keeps going |
| `phoneClosed` | Bridge | `serial` and why the session ended: `unplugged`, `chrome-exited`, `bridge-stopping` or `closed` |

The Bridge looks for phones only while someone is watching: an extension that speaks 23, or an app
showing its Android tab. The control socket has an `android` op that reads the same state,
subscribes to `android-changed` with `watch` (and lets go with `watch: false`), answers only what is
already known with `peek` (`NOT_CHECKED` while nobody watches), and opens Chrome on a phone with
`launch` and an optional `url` (refused to an agent run's connection). It has no way to send a
DevTools command. Every action on the phone goes through the extension, which is where the
blocked-sites list is checked. [Android phones](android.md) follows a tap through all of it.

---

## What this does not protect against

Pairing controls **which browser**, not which local process. Anything running as your user can read
the lockfile and drive an already-paired browser through the control port. Browsentic assumes your
user account is the trust boundary (see [guide/limits.md](../guide/limits.md#pairing-controls-which-browser-not-which-process)).

---

## Next

**[The action registry →](registry.md)**: what can be sent once a connection exists.
