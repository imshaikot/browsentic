---
layout: layouts/doc.njk
pageKey: docs
title: "Updating and uninstalling"
seoTitle: "Updating and uninstalling — Browsentic user guide"
description: "Updating and uninstalling. Then reload the extension at chrome://extensions (↻ on the Browsentic card) and restart the daemon: Both steps are needed, for the…"
deck: ""
docsPath: "guide/maintenance.md"
section: "guide"
sectionLabel: "User guide"
sectionOrder: 1
order: 9
isIndex: false
permalink: "/docs/guide/maintenance/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/maintenance.md"
---
---

## Updating

```sh
git pull
yarn setup
```

Then reload the extension at `chrome://extensions` (↻ on the Browsentic card) and restart the
daemon:

```sh
browsentic restart
```

Both steps are needed, for the same reason in two places: **nothing reloads itself.** Chrome does
not auto-reload an unpacked extension, and a running daemon keeps the old build in memory until it
is replaced.

**Rebuild both halves together.** If only one side is rebuilt, `browsentic status` reports
`manifest: DRIFTED`. The daemon then falls back to the tools the browser actually has and tells
your MCP clients the list changed — it degrades loudly rather than into tool calls that fail at the
far end — but you should fix the drift rather than run on it.

Your pairing survives updates. `yarn daemon:link` only needs re-running if the link is broken.

### When an update adds a permission

An update that widens the extension's permissions — the `downloads` permission that file capture
needs, for instance — makes Chrome **disable the extension** on reload until you accept the new one. The card at `chrome://extensions`
says so and offers the prompt; Firefox asks the same question in its own way. Until you accept, the
browser is unpaired and every page tool answers `EXTENSION_OFFLINE`, and the tool that needed the
permission answers `DOWNLOADS_UNAVAILABLE` if it is reached first.

Nothing is lost by it — accepting reconnects the pairing you already had.

### Why `yarn daemon:build` alone changes nothing

The daemon has no start command: the first CLI or MCP client that needs it spawns it, and it lives
until `browsentic stop` or 30 idle minutes with nothing attached. A rebuild does not touch the
process already running.

`yarn daemon:restart` is the one that does both — it rebuilds, stops the stale daemon, and brings up
the fresh build.

---

## Uninstalling

```sh
browsentic revoke      # unpair every browser
browsentic stop        # stop the daemon
yarn daemon:unlink        # remove browsentic from PATH
rm -rf ~/.browsentic ~/browsentic
```

Then remove the extension at `chrome://extensions`. That also clears recordings and stored files,
which live in extension storage rather than on disk.

What those two directories held is listed in [internals/state.md](/docs/internals/state/) — worth a
look before deleting, since `~/browsentic/skills/` contains any site maps you generated and any
notes you wrote by hand.

---

## Development

```sh
yarn dev              # build, launch a throwaway Chrome profile, hot reload
yarn dev:firefox
yarn build            # production build
yarn zip              # store-ready archive
yarn daemon:dev          # rebuild the daemon on change
yarn daemon:restart      # rebuild, then swap the running daemon for the fresh build
yarn daemon:manifest     # print the tool manifest, no browser needed
yarn check            # both type checks plus both fixture suites
```

Contributing, including what to run before a pull request:
[internals/contributing.md](/docs/internals/contributing/).
