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

Four steps, and the order matters. Only the second one depends on how you installed.

**1. Unpair the browsers and stop the daemon.**

```sh
browsentic revoke      # unpair every browser
browsentic stop        # stop the daemon
```

`revoke` asks the running daemon to drop its session keys, so it has to come before `stop` rather
than after. If you installed through `npx` and never installed the command permanently, these are
`npx browsentic revoke` and `npx browsentic stop`.

**2. Remove the command**, if you have one on your PATH. This is the step that differs:

| How you installed | What to remove |
| --- | --- |
| `npx browsentic setup` | Nothing. `npx` runs the package from its own cache and never puts anything on your PATH. |
| `npm i -g browsentic` | `npm rm -g browsentic` |
| From a clone | `yarn daemon:unlink`, which removes the global link `yarn daemon:link` created |

**3. Remove the extension** at `chrome://extensions`.

Do this *before* the next step. The folder Chrome loaded is `~/browsentic/extension/chrome-mv3`,
which step 4 deletes — remove the directory first and the browser is left holding a broken card.
Removing the extension also clears recordings and stored files, which live in extension storage
rather than on disk.

**4. Delete the two directories.**

```sh
rm -rf ~/.browsentic ~/browsentic
```

`~/.browsentic` holds pairing keys, config, approvals and logs; `~/browsentic` holds the extension
you just removed, plus skills, screenshots and captured downloads. If you set `BROWSENTIC_HOME`,
the first one is wherever you pointed it.

What those directories held is listed in [internals/state.md](../internals/state.md) — worth a look
before deleting, since `~/browsentic/skills/` contains any site maps you generated and any notes you
wrote by hand, and nothing else has a copy of them.

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
[internals/contributing.md](../internals/contributing.md).
