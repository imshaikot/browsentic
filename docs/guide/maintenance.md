# Updating and uninstalling

---

## Updating

```sh
browsentic update
```

That refreshes two things, in order: **the command itself**, then the extension it carries.

The Firefox add-on is not carried by the package. It updates itself: every release publishes a
signed `.xpi` and an `updates.json` beside it, Firefox polls that file about once a day, and
**Check for Updates** in `about:addons` polls it now. `browsentic update` still refreshes the daemon.

The first half matters more than it sounds. `npx browsentic setup` does not put anything on your
`PATH` — it runs the package out of npm's own throwaway cache, and npm names that directory after
the spec it was asked for, records the version it resolved *the first time*, and reuses it forever
without asking the registry again. So a machine set up with `npx` keeps running whatever version it
first saw, and since the extension ships inside the package, `update` had nothing newer to install
and reported "already current" every time. It now checks the registry, replaces the stale cache, and
re-runs itself under the new version.

`--no-self-update` skips the check, and a pinned `npx browsentic@<version>` is never upgraded past —
a pin is a decision, not a stale cache.

From a clone, `update` says so and leaves the checkout alone:

```sh
git pull
yarn setup
```

Either way the last step is yours: **nothing reloads itself.** Chrome does not auto-reload an
unpacked extension, so press ↻ on the Browsentic card at `chrome://extensions`. `browsentic update`
has already replaced the daemon; from a clone, `browsentic restart` is that half, because a running
daemon keeps the old build in memory until it is swapped out.

`browsentic status` names both versions when they disagree, and says which one to reload.

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
browsentic uninstall
```

On Firefox, remove the add-on from `about:addons` as well — it was installed from a file, not from
the directory this command removes.

It prints exactly what it is about to remove and asks before removing any of it:

| | |
| --- | --- |
| daemon | Whatever is *answering* on 8765–8767, not what the lockfile claims. Sessions are revoked through it first, so a connected browser is told it is unpaired rather than left to discover it |
| state | `~/.browsentic` — pairing keys, config, approvals, logs |
| files | `~/browsentic` — the unpacked extension, skills, site maps, screenshots, captured downloads |
| npx cache | Every `~/.npm/_npx/*` directory holding a copy of the package |

| Flag | Does |
| --- | --- |
| `--dry-run` | Print the plan and stop |
| `--yes` / `-y` | Skip the confirmation. Required when stdin is not a terminal, since there is nobody to ask |
| `--keep-skills` | Leave `skills/` behind. Nothing else has a copy of your site maps |

**Remove the card at `chrome://extensions` first.** That is the one step no command can do for you,
and doing it afterwards leaves the browser holding a folder that is no longer there. It is also what
clears recordings and held secrets, which live in extension storage rather than on disk.

Two things it names but will not touch: the command itself (`npm rm -g browsentic`, or
`yarn daemon:unlink` from a clone) and the entry in your MCP client
(`claude mcp remove browsentic`). It also names, without deleting, any directory you pointed
somewhere else with `screenshotDir`, `downloadDir` or `skillsDir` — you put those there.

### Why the manual procedure was not enough

It could not reach two of these, and both fail quietly:

**The npx cache.** Deleting `~/.browsentic` and `~/browsentic` leaves it untouched, so the reinstall
afterwards runs the same cached CLI and lays down the same old extension. It looks like the installer
is broken.

**An orphaned daemon.** `rm -rf ~/.browsentic` takes the lockfile with it, and the running daemon
never notices — it holds its port for as long as the machine is up, and nothing that reads
`~/.browsentic` can see it any more. `browsentic stop` now probes the ports instead of trusting the
lockfile, so it finds that one too.

If you would rather do it by hand, the order is: `browsentic revoke`, `browsentic stop`, remove the
card at `chrome://extensions`, `rm -rf ~/.browsentic ~/browsentic`, then delete every
`~/.npm/_npx/*` directory containing `node_modules/browsentic`. `revoke` needs the daemon, so it
comes before `stop`; the cache is the step people miss.

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
