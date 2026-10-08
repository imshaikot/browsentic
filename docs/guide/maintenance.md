# Updating and uninstalling

How the extension and Browsentic Bridge each update, and what `browsentic uninstall` removes,
including the npx cache and any Bridge process still running.

---

## Updating

The extension and Browsentic Bridge update separately and do not have to be the same version.
Bridge 0.8 accepts the extension from 0.7.14 on, older or newer than itself, so a store copy keeps
working whether it updates first or last.

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

It updates, in order: **the command itself** (restarting the Bridge on it), then the unpacked
extension folder if you use one. A store copy is not in the package; `update` tells you it updates
itself.

Updating the command first matters because of npx. `npx browsentic setup` puts nothing on your
`PATH`: it runs the package from npm's cache, keyed by the requested spec, which keeps the version
resolved *the first time* and never asks the registry again. A machine set up with `npx` kept
running that version, so `update` found nothing newer to install (the unpacked extension ships
inside the package) and reported "already current" every time. It now checks the registry, replaces
the stale cache and re-runs itself under the new version. `npx browsentic@latest` asks the registry
every time.

`--no-self-update` skips the check. A pinned `npx browsentic@<version>` is never upgraded, because a
pin is deliberate.

From a clone, `update` leaves the checkout alone and tells you to run:

```sh
git pull
yarn setup
```

An unpacked copy never reloads itself: press ↻ on its card at `chrome://extensions`.
`browsentic update` has already replaced the Bridge; from a clone, run `browsentic restart`, because
a running Bridge keeps the old build in memory until it is replaced. `browsentic status` shows each
browser's version and which unpacked copy to reload.

**When the extension and the Bridge list different tools.** A store copy a version ahead of or
behind the Bridge can carry a different set of tools. The Bridge then serves the tools the browser
actually has and tells any connected MCP clients that the list changed, and `browsentic status`
reports `tools: the extension's own list`. This is normal while one side waits for its update. From
a clone, rebuild both together.

Pairing survives updates. Re-run `yarn daemon:link` only if the link is broken.

### When an update adds a permission

When an update adds a permission to the extension (for instance `downloads`, which file capture
needs), Chrome **disables the extension** on reload until you accept it. Its card at
`chrome://extensions` says so and offers the prompt; Firefox asks in its own way. Until you accept,
the browser is unpaired and every page tool answers `EXTENSION_OFFLINE`, and the tool that needed
the permission answers `DOWNLOADS_UNAVAILABLE` if it is reached first.

Nothing is lost: accepting reconnects the pairing you already had.

### Why `yarn daemon:build` alone changes nothing

The Bridge starts on demand: the first CLI command, MCP client or browser that needs it starts it
(so does `browsentic start`), and it runs until `browsentic stop` or 30 idle minutes with nothing
attached. A rebuild does not touch the process already running.

`yarn daemon:restart` does both: it rebuilds, stops the stale daemon and starts the fresh build.

---

## Uninstalling

```sh
browsentic uninstall
```

**Remove the extension from each browser first** (right-click its toolbar icon → **Remove**, or
`about:addons` in Firefox). No command can do this for you: a store copy was never in the
directories this command removes, and recordings and held secrets live in extension storage rather
than on disk. Removing an unpacked copy afterwards leaves the browser pointing at a folder that no
longer exists.

The command prints what it will remove and asks before removing anything:

| | |
| --- | --- |
| Bridge | Whatever is *answering* on 8765–8767, not what the lockfile claims. Sessions are revoked through it first, so a connected browser is told it is unpaired rather than left to discover it |
| state | `~/.browsentic`: pairing keys, config, approvals, logs |
| files | `~/browsentic`: the unpacked extension if you used one, skills, site maps, screenshots, captured downloads |
| npx cache | Every `~/.npm/_npx/*` directory holding a copy of the package |

| Flag | Does |
| --- | --- |
| `--dry-run` | Print the plan and stop |
| `--yes` / `-y` | Skip the confirmation. Required when stdin is not a terminal, since there is nobody to ask |
| `--keep-skills` | Leave `skills/` behind. Nothing else has a copy of your site maps |

It names, but does not remove, the command itself (`npm rm -g browsentic`, or `yarn daemon:unlink`
from a clone), the entry in your MCP client (`claude mcp remove browsentic`), and any directory you
moved elsewhere with `screenshotDir`, `downloadDir` or `skillsDir`.

### Why the manual procedure was not enough

Deleting the folders by hand misses two things, and both fail quietly:

**The npx cache.** Deleting `~/.browsentic` and `~/browsentic` leaves it untouched, so a reinstall
runs the same cached CLI and lays down the same old extension, which looks like a broken installer.

**An orphaned Bridge.** `rm -rf ~/.browsentic` deletes the lockfile, but the running process does
not notice: it holds its port for as long as the machine is up, and nothing that reads
`~/.browsentic` can find it. `browsentic stop` now probes the ports instead of trusting the
lockfile, so it finds that process too.

To do it by hand, in this order: `browsentic revoke`, `browsentic stop`, remove the extension from
each browser, `rm -rf ~/.browsentic ~/browsentic`, then delete every `~/.npm/_npx/*` directory
containing `node_modules/browsentic`. `revoke` needs the Bridge, so it comes before `stop`. The
cache is the step people miss.

[internals/state.md](../internals/state.md) lists what those directories hold. Check it before
deleting: `~/browsentic/skills/` holds any site maps you generated and any notes you wrote by hand,
and nothing else has a copy of them.

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
