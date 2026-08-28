---
layout: layouts/doc.njk
pageKey: docs
title: "State on disk"
seoTitle: "State on disk — Browsentic internals"
description: "Nothing lives in the repository. Held secrets never reach disk at all. A credential the sanitizer seals out of a page is kept in the extension's…"
deck: "Nothing lives in the repository."
docsPath: "internals/state.md"
section: "internals"
sectionLabel: "Internals"
sectionOrder: 4
order: 8
isIndex: false
permalink: "/docs/internals/state/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/internals/state.md"
---
![Who writes what, where it lands, and the three things that never reach disk](/docs/assets/state.png)

```
~/.browsentic/                 (mode 0700, override with BROWSENTIC_HOME)
├── daemon.json    0600        lockfile: pid, port, control token, protocol + daemon version
├── auth.json      0600        outstanding pairing code, session keys per origin
├── config.json                optional, hand-written
├── approvals.json 0600        "always on this site" grants, one action + host per entry
├── daemon.log                 run starts, routed skills, every tool call and its outcome
└── skills/                    hand-written skill overrides

~/browsentic/                  (paths configurable)
├── extension/chrome-mv3/      the unpacked extension `browsentic setup` installs
├── skills/                    panel uploads + activated site maps
│   ├── acme-com/SKILL.md
│   └── .staging/              maps awaiting review — unreadable to the loader
└── screenshot/    0600        captures taken with save: true
```

| File | Written by | Notes |
| --- | --- | --- |
| `daemon.json` | Each daemon at startup | The control token dies with the daemon that minted it. Read it with `browsentic token` |
| `auth.json` | Pairing | Session keys are per extension origin and survive restarts. Cleared by `browsentic revoke` |
| `config.json` | You, and the agent picker | Re-read before every run — no restart needed. [Reference](/docs/guide/configuration/) |
| `approvals.json` | **Always on ‹host›** | One action + host per entry. Only short-circuits a `confirm` |
| `daemon.log` | The daemon | `browsentic logs`. Local [instant commands](/docs/guide/features/instant-commands/) never appear here, by design |

## The three exceptions

**Held secrets** never reach disk at all. A credential the sanitizer seals out of a page is kept in
the extension's `browser.storage.session` under `browsentic/secrets`, capped at 64 entries, expiring
after two hours and emptied by the browser on restart. The daemon never receives one.

**Recordings** stay in the extension's own storage, not on disk. Removing the extension removes them.

**Tab sessions** live in `browser.storage.session` under `browsentic/tabSessions`, so they are gone
when the browser closes.

## Relocating

`BROWSENTIC_HOME` moves `~/.browsentic` wholesale. `screenshotDir` and `skillsDir` in config move
those two `~/browsentic` subdirectories independently, and `browsentic setup --dir` installs the
extension somewhere else.

---

## Next

**[Contributing →](/docs/internals/contributing/)**
