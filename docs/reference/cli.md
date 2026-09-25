# CLI reference

```
browsentic <command>
```

With no command it prints usage. Most commands start the daemon if one is not already running;
`status`, `stop`, `logs`, `token`, `tools`, `skills`, `approvals`, `downloads` and `uninstall` do
not — an uninstall that started a daemon would be absurd.

---

## Installing

| Command | Does |
| --- | --- |
| `browsentic setup` | Install the extension, start the daemon, print a pairing code |
| `browsentic update` | Pull the newest build: the command itself first, then the extension, then restart the daemon |
| `browsentic uninstall` | Stop the daemon and remove everything Browsentic wrote |

`setup` writes the extension to `~/browsentic/extension/chrome-mv3` and leaves you two steps: load
that folder at `chrome://extensions` with Developer mode on, and paste the code into the popup.

The install path never carries a version, deliberately. Chrome derives an unpacked extension's ID
from the absolute path of its directory, and the browser keeps the extension's storage — the
install id and the session key with it — under that ID, so a versioned path would unpair the browser
on every update.

| Flag | Does |
| --- | --- |
| `--dir <path>` | Install somewhere else. Needed for Flatpak or Snap browsers, which cannot read `~/browsentic` without a filesystem grant |
| `--no-pair` | Install and start the daemon, mint no code |
| `--force` | Rewrite every file even when the installed build already matches |
| `--browser <name>` | `chrome` (the default) or `firefox`. Firefox has no folder to load: the command starts the daemon, prints the link to the signed add-on for this same version — and says so if Mozilla has not attached it to the release yet — then the pairing code. `update --browser firefox` only restarts the daemon, because Firefox updates the add-on on its own |
| `--no-self-update` | Install what this copy carries, without asking the registry whether a newer one exists |
| `--json` | Machine-readable result. Progress goes to stderr, so stdout stays parseable |

`setup` and `update` both replace the command itself when the registry has something newer, because
the extension ships *inside* the package — a stale CLI installs a stale extension and says
"already current". Under `npx` that lasts as long as the cache does, which is what made `update`
look like it did nothing. A pinned `npx browsentic@<version>` is never upgraded past, and a source
checkout is told rather than touched.

### Uninstall

| Flag | Does |
| --- | --- |
| `--dry-run` | Print the plan and stop |
| `--yes` / `-y` | Skip the confirmation. Required when stdin is not a terminal |
| `--keep-skills` | Leave `skills/` behind — site maps and hand-written notes have no other copy |

It removes the daemon (found by probing 8765–8767, so an orphan whose lockfile was deleted is still
caught), `~/.browsentic`, `~/browsentic`, and every `~/.npm/_npx/*` directory holding a copy of the
package. It names, but will not touch, the extension card at `chrome://extensions`, the command
itself, your MCP client's entry, and any directory you moved with `screenshotDir`, `downloadDir` or
`skillsDir`.

See [guide/install.md](../guide/install.md) and [guide/maintenance.md](../guide/maintenance.md).

## Pairing

| Command | Does |
| --- | --- |
| `browsentic pair` | Issue a one-time code to type into the extension popup. 8 characters, valid 10 minutes, single use |
| `browsentic sessions` | List paired browsers |
| `browsentic revoke [id]` | Unpair one browser by the id `sessions` prints, or all of them. An origin still works, and unpairs every browser presenting it |

See [guide/pair.md](../guide/pair.md).

## Agents

| Command | Does |
| --- | --- |
| `browsentic agent` | Show which agent runs the side panel, and which are installed |
| `browsentic agent <name>` | Switch to `claude`, `codex`, `antigravity`, `vibe`, `grok`, `cursor`, `qwen` or `opencode` |
| `browsentic agent fix <name>` | Let Browsentic fix what that agent still needs |
| `browsentic agent model <name> [model]` | Pin that agent’s model in `config.json`; omit the model to go back to the CLI’s own default |

`agent fix antigravity` appends exactly one entry, `mcp(browsentic/*)`, to `permissions.allow` in
`~/.gemini/antigravity-cli/settings.json`. See [guide/agents.md](../guide/agents.md).

The verb was `agent setup` before `setup` came to mean installing the extension. The old spelling
still works and is undocumented.

## MCP

| Command | Does |
| --- | --- |
| `browsentic mcp` | Serve MCP over stdio. What an [MCP client](../guide/mcp-clients.md) runs, not something you type |

`browsentic-mcp` is a legacy alias binary that serves MCP on bare invocation, so client
configurations written against the older name keep working.

## State and diagnostics

| Command | Does |
| --- | --- |
| `browsentic status` | Daemon and extension state, the installed build, manifest sync, pairing count |
| `browsentic logs` | Print the daemon log (`~/.browsentic/daemon.log`) |
| `browsentic tools` | Print the bundled tool manifest as JSON. **No browser needed** |
| `browsentic skills` | Every skill the router can see, tagged `bundled`, `user` or `uploaded` |
| `browsentic approvals` | The "always on this site" grants |
| `browsentic approvals clear [host]` | Forget them, all or one site's |
| `browsentic tasks` | Scheduled tasks, when each runs next and how it last went |
| `browsentic tasks pause\|resume [id]` | Pause or resume one task, or every task at once. An id prefix is enough |
| `browsentic tasks delete <id>` | Delete a task |
| `browsentic downloads` | Files captured from pages, with notes and where they landed |
| `browsentic downloads clear` | Delete all of them |
| `browsentic token` | The control token, for MCP clients. Not for the browser |

`agent`, `skills`, `approvals`, `tasks` and `downloads` take `--json`. It is what the [macOS app](../guide/mac-app.md)
reads, so the app and a terminal can never disagree about what is on disk.

## Lifecycle

| Command | Does |
| --- | --- |
| `browsentic start` | Bring the background daemon up, if it is not already |
| `browsentic stop` | Stop the background daemon, whichever of 8765–8767 is answering |
| `browsentic restart` | Stop the daemon and bring up a fresh one |
| `browsentic --version` / `-v` | Print the version |
| `browsentic help` / `--help` / `-h` | Usage |

**A rebuild does not replace a running daemon.** It keeps the old code in memory until `stop` or
`restart`. In the repository, `yarn daemon:restart` chains the rebuild with the restart.

---

## Repository scripts

Not the CLI, but frequently wanted alongside it:

| Command | Does |
| --- | --- |
| `yarn setup` | Install and build both halves |
| `yarn daemon:link` | Put `browsentic` on your `PATH` from a source checkout |
| `yarn daemon:unlink` | Take it off again |
| `yarn daemon:restart` | Rebuild the daemon, then swap the running one for it |
| `yarn daemon:manifest` | Build and print the tool manifest |
| `yarn check` | Both type checks plus both fixture suites |
| `yarn mac:app` | Build both halves, then `dist/mac/Browsentic.app` around them (macOS only) |
| `yarn mac:dmg` | The same, wrapped in `dist/mac/Browsentic-<version>.dmg` |
| `yarn check:intent "<utterance>"` | Explain how one instruction would be routed |

Full list: [internals/contributing.md](../internals/contributing.md).
