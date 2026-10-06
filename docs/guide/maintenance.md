# Updating and uninstalling

---

## Updating

Each half updates on its own, and they don't have to be the same version. Browsentic Bridge 0.8
works with the extension from 0.7.14 on, older or newer than itself, so a store copy that updates
first, or last, keeps working.

| What | How |
| --- | --- |
| The extension from the Chrome Web Store or Edge Add-ons | Updates itself when the browser checks, every few hours. **Update** at `chrome://extensions` (`edge://extensions` in Edge), with Developer mode on, checks now |
| The Firefox add-on | Updates itself: every release publishes a signed `.xpi` and an `updates.json` beside it, Firefox polls that file about once a day, and **Check for Updates** in `about:addons` polls it now |
| Browsentic Bridge, from the Mac or Windows app | The app's **Update now** card ([macOS](mac-app.md#updating), [Windows](windows-app.md#updating)) |
| Browsentic Bridge, from `npx` or `npm` | `browsentic update`, below |
| An unpacked copy | `browsentic update` rewrites the folder, then press ↻ on its card |

```sh
browsentic update
```

That refreshes, in order: **the command itself**, restarting the Bridge on it, then the unpacked
extension folder if you load one. A store copy is not in the package; `update` says it updates
itself.

The first half matters more than it sounds. `npx browsentic setup` does not put anything on your
`PATH` — it runs the package out of npm's own throwaway cache, and npm names that directory after
the spec it was asked for, records the version it resolved *the first time*, and reuses it forever
without asking the registry again. So a machine set up with `npx` keeps running whatever version it
first saw, and since the extension ships inside the package, `update` had nothing newer to install
and reported "already current" every time. It now checks the registry, replaces the stale cache, and
re-runs itself under the new version. `npx browsentic@latest` asks the registry every time.

`--no-self-update` skips the check, and a pinned `npx browsentic@<version>` is never upgraded past —
a pin is a decision, not a stale cache.

From a clone, `update` says so and leaves the checkout alone:

```sh
git pull
yarn setup
```

An unpacked copy is the one thing that never reloads itself: press ↻ on its card at
`chrome://extensions`. `browsentic update` has already replaced the Bridge; from a clone,
`browsentic restart` is that half, because a running Bridge keeps the old build in memory until it
is swapped out. `browsentic status` names each browser's version, and says which unpacked copy to
reload.

**When the two halves list different tools.** A store copy a version ahead of the Bridge, or behind
it, can carry a different set of tools. The Bridge then serves the tools the browser actually has
and tells your MCP clients the list changed, and `browsentic status` reports `tools: the
extension's own list`. That is normal while one side waits on its update. From a clone, rebuild both
halves together.

Your pairing survives updates. `yarn daemon:link` only needs re-running if the link is broken.

### When an update adds a permission

An update that widens the extension's permissions — the `downloads` permission that file capture
needs, for instance — makes Chrome **disable the extension** on reload until you accept the new one. The card at `chrome://extensions`
says so and offers the prompt; Firefox asks the same question in its own way. Until you accept, the
browser is unpaired and every page tool answers `EXTENSION_OFFLINE`, and the tool that needed the
permission answers `DOWNLOADS_UNAVAILABLE` if it is reached first.

Nothing is lost by it — accepting reconnects the pairing you already had.

### Why `yarn daemon:build` alone changes nothing

The Bridge has no start command: the first CLI or MCP client that needs it spawns it, and it lives
until `browsentic stop` or 30 idle minutes with nothing attached. A rebuild does not touch the
process already running.

`yarn daemon:restart` is the one that does both — it rebuilds, stops the stale daemon, and brings up
the fresh build.

---

## Uninstalling

```sh
browsentic uninstall
```

Remove the extension from each browser as well (right-click its toolbar icon → **Remove**, or
`about:addons` in Firefox): a store copy was never in the directories this command removes.

It prints exactly what it is about to remove and asks before removing any of it:

| | |
| --- | --- |
| Bridge | Whatever is *answering* on 8765–8767, not what the lockfile claims. Sessions are revoked through it first, so a connected browser is told it is unpaired rather than left to discover it |
| state | `~/.browsentic` — pairing keys, config, approvals, logs |
| files | `~/browsentic` — the unpacked extension if you used one, skills, site maps, screenshots, captured downloads |
| npx cache | Every `~/.npm/_npx/*` directory holding a copy of the package |

| Flag | Does |
| --- | --- |
| `--dry-run` | Print the plan and stop |
| `--yes` / `-y` | Skip the confirmation. Required when stdin is not a terminal, since there is nobody to ask |
| `--keep-skills` | Leave `skills/` behind. Nothing else has a copy of your site maps |

**Remove the extension from your browsers first.** That is the one step no command can do for you.
It is also what clears recordings and held secrets, which live in extension storage rather than on
disk, and for an unpacked copy, doing it afterwards leaves the browser holding a folder that is no
longer there.

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
extension from each browser, `rm -rf ~/.browsentic ~/browsentic`, then delete every
`~/.npm/_npx/*` directory containing `node_modules/browsentic`. `revoke` needs the Bridge, so it
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
yarn daemon:dev          # rebuild the Bridge on change
yarn daemon:restart      # rebuild, then swap the running daemon for the fresh build
yarn daemon:manifest     # print the tool manifest, no browser needed
yarn check            # both type checks plus both fixture suites
```

Contributing, including what to run before a pull request:
[internals/contributing.md](../internals/contributing.md).
