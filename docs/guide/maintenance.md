# Updating and uninstalling

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

Your pairing survives updates. `yarn mcp:link` only needs re-running if the link is broken.

### Why `yarn mcp:build` alone changes nothing

The daemon has no start command: the first CLI or MCP client that needs it spawns it, and it lives
until `browsentic stop` or 30 idle minutes with nothing attached. A rebuild does not touch the
process already running.

`yarn mcp:restart` is the one that does both — it rebuilds, stops the stale daemon, and brings up
the fresh build.

---

## Uninstalling

```sh
browsentic revoke      # unpair every browser
browsentic stop        # stop the daemon
yarn mcp:unlink        # remove browsentic from PATH
rm -rf ~/.browsentic ~/browsentic
```

Then remove the extension at `chrome://extensions`. That also clears recordings and stored files,
which live in extension storage rather than on disk.

What those two directories held is listed in [internals/state.md](../internals/state.md) — worth a
look before deleting, since `~/browsentic/skills/` contains any site maps you generated and any
notes you wrote by hand.

---

## Development

```sh
yarn dev              # build, launch a throwaway Chrome profile, hot reload
yarn dev:firefox
yarn build            # production build
yarn zip              # store-ready archive
yarn mcp:dev          # rebuild the daemon on change
yarn mcp:restart      # rebuild, then swap the running daemon for the fresh build
yarn mcp:manifest     # print the tool manifest, no browser needed
yarn check            # both type checks plus both fixture suites
```

Contributing, including what to run before a pull request:
[internals/contributing.md](../internals/contributing.md).
