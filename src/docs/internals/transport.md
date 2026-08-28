---
layout: layouts/doc.njk
pageKey: docs
title: "Transport and authorization"
seoTitle: "Transport and authorization — Browsentic internals"
description: "How a connection is established, and how each side proves it is allowed. The same sequence, animated →"
deck: "How a connection is established, and how each side proves it is allowed."
docsPath: "internals/transport.md"
section: "internals"
sectionLabel: "Internals"
sectionOrder: 4
order: 1
isIndex: false
permalink: "/docs/internals/transport/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/internals/transport.md"
---
![The origin gate refusing a web page, then the mutual pairing handshake](/docs/assets/transport.png)

[The same sequence, animated →](/docs/assets/transport.gif)

---

## One server, three ports

The daemon runs one HTTP server that answers `GET /health` and upgrades everything else to a
WebSocket. It binds the first free port of **8765, 8766, 8767**. If all three are taken it will not
start.

---

## The origin gate

Every upgrade is classified by the handshake `Origin` header before anything else happens:

| `Origin` | Role | Requirement |
| --- | --- | --- |
| `chrome-extension://…`, `moz-extension://…`, `safari-web-extension://…` | `extension` | Proof of a pairing code, or of a session key bound to that same origin |
| Any other value | — | **Refused.** This is what keeps web pages out |
| Absent | `control` | `Authorization: Bearer <token>` matching the lockfile, compared with `timingSafeEqual` |

Every request — `/health` included — must also carry a loopback `Host`. A page whose own DNS points
at `127.0.0.1` still arrives with the attacker's hostname, so **DNS rebinding gets a 403 before the
`Origin` check even runs**.

The split matters because any web page can open a WebSocket to loopback. Browsers set `Origin`
themselves and page JavaScript cannot forge it, so a page reaching the daemon is classified as a web
origin and rejected outright. Native clients send no `Origin`, so they land in the control lane —
where a token they could only have read off the local filesystem is required.

Two independent gates, then: **the origin says what kind of peer this is, and the credential says
whether this particular peer is allowed.**

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

The extension connects to nothing until you pair it.

1. `browsentic pair` asks the daemon for a code: 8 characters from an alphabet with the
   ambiguous glyphs removed, valid **10 minutes**, single use.
2. You paste it into the popup. The extension dials `ws://127.0.0.1:<port>/extension`, walking the
   three ports, and sends `hello` — which names *which* secret it holds and a fresh nonce, never the
   secret itself.
3. The daemon answers `challenge` with a nonce of its own. Both sides now share a transcript:
   protocol version, extension version, manifest hash, and the two nonces.
4. The extension replies `prove` with `HMAC(secret, "browsentic/client" ‖ transcript)`. For a
   pairing code the key is not the code but `PBKDF2(code, nonces, 250 000)`, so recording one
   handshake does not let anyone grind an 8-character code offline.
5. The daemon verifies, then proves *itself*: `welcome` carries
   `HMAC(secret, "browsentic/server" ‖ transcript ‖ the rest of the welcome)`. The two labels are
   distinct, so an impostor cannot reflect the extension's own proof back at it.
6. On pairing, the daemon mints a **session key** (32 random bytes) bound to that extension origin
   and returns it XORed with a keystream derived from the same secret, so the long-lived credential
   never crosses the wire in the clear. It survives browser and daemon restarts and dies only when
   you `browsentic revoke`.

### Why the mutual half matters

The three ports are well known and any local process can bind one first, so an extension that
trusted whatever answered could be driven by a squatter.

Instead, a socket that closes without a **verified** `welcome` — a squatter, a daemon from an older
protocol, an `unauthorized` frame, five seconds of silence — is abandoned and the walk moves to the
next port. Only a peer that proves it holds the same secret ever gets to send an `invoke`.

### Reconnection

Exponential backoff from 1 s to 30 s with jitter, plus a one-minute `browser.alarms` tick that
re-dials if the service worker was torn down in between.

A rejected `hello` comes back as an `unauthorized` frame carrying a `retryable` flag. Nothing has
proved itself at that point, so the extension treats it as a **claim rather than a verdict**: it
notes the reason, tries the remaining ports, and if none work it reports the error and stops
dialling — but it never deletes the stored key. Only pairing again or `disconnect` replaces it.

---

## Protocol version

Both sides compile in `SOCKET_PROTOCOL_VERSION` (currently **14**). A mismatch closes the socket
with an explicit reason instead of letting two incompatible frame vocabularies talk past each other.

---

## What this does not protect against

Pairing controls **which browser**, not which local process. Anything running as your user can read
the lockfile and drive an already-paired browser through the control port. Browsentic assumes your
user account is the trust boundary — see [guide/limits.md](/docs/guide/limits/#pairing-controls-which-browser-not-which-process).

---

## Next

**[The action registry →](/docs/internals/registry/)** — what can be sent once a connection exists.
