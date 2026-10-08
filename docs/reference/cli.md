# CLI reference

Every command and flag of `browsentic`, the command for Browsentic Bridge (the part of Browsentic
that runs on your computer).

```
browsentic <command>
```

With no command it prints usage. Most commands start the Bridge if it is not already running;
`status`, `browsers`, `stop`, `logs`, `token`, `tools`, `skills`, `approvals`, `downloads` and
`uninstall` do not.

---

## Installing

| Command | Does |
| --- | --- |
| `browsentic setup` | Start the Bridge, then add the extension to a browser and pair the two |
| `browsentic update` | Pull the newest Bridge, restart it, and refresh the unpacked folder if you load one |
| `browsentic browsers` | List the browsers on this computer, where each gets the extension, and which are connected |
| `browsentic uninstall` | Stop the Bridge and remove everything Browsentic wrote |

On a terminal, `setup` checks your agent and asks which browser should get the extension. It opens
that browser's store page in it (the Chrome Web Store for Chrome, Brave, Arc, Vivaldi, Opera and
Chromium; Edge Add-ons for Edge; the signed add-on for Firefox), prints a pairing code, and waits
up to five minutes for the browser to connect. Ctrl-C stops the wait and undoes nothing. With no
terminal and no `--browser`, it asks nothing: it prints where each browser gets the extension and a
code, so a script or an app never hangs on it.

Every run also registers the Bridge with each browser it finds, so the browser can start it when it
is down (`wake-up:` in `status`).

| Flag | Does |
| --- | --- |
| `--browser <name>` | `chrome`, `edge`, `brave`, `arc`, `vivaldi`, `opera`, `chromium` or `firefox`: skip the question. For Firefox it also says when Mozilla has not attached the signed add-on to this version's release yet |
| `--unpacked` | Write the extension to `~/browsentic/extension/chrome-mv3` and print the steps to load it at the browser's extensions page, for a browser that cannot reach a store or for an unreleased build |
| `--dir <path>` | With `--unpacked`, write it somewhere else. Needed for Flatpak or Snap browsers, which cannot read `~/browsentic` without a filesystem grant. Remembered, so `update` refreshes the same copy |
| `--no-open` | Print the store link instead of opening it |
| `--no-wait` | Print the code and return, instead of waiting for the browser |
| `--no-pair` | Mint no code. `update` passes it |
| `--force` | Rewrite every file of the unpacked folder even when it already matches |
| `--no-self-update` | Run what this copy carries, without asking the registry whether a newer one exists |
| `--json` | Machine-readable result, with every browser's row, as the apps read it. Never asks, never waits |

The unpacked folder is written only when you ask for it, and kept current once it exists: `setup`
and `update` refresh it in place. Its path deliberately never carries a version. Chrome derives an
unpacked extension's ID from the absolute path of its directory, and the browser keeps the
extension's storage (including the install id and the session key) under that ID, so a versioned
path would unpair the browser on every update.

`setup` and `update` both replace the command itself when the registry has something newer. A
stale command runs a stale Bridge, lays down a stale unpacked folder, and reports "already
current". Under `npx` a stale copy lasts as long as the cache does, which is what made `update` look
like it did nothing; `npx browsentic@latest` checks every time. A pinned `npx browsentic@<version>`
is never upgraded, and a source checkout is told rather than touched.

### Uninstall

| Flag | Does |
| --- | --- |
| `--dry-run` | Print the plan and stop |
| `--yes` / `-y` | Skip the confirmation. Required when stdin is not a terminal |
| `--keep-skills` | Leave `skills/` behind. Site maps and hand-written notes have no other copy |

It removes the Bridge (found by probing 8765–8767, so an orphan whose lockfile was deleted is still
caught), `~/.browsentic`, `~/browsentic`, and every `~/.npm/_npx/*` directory holding a copy of the
package. It lists, but does not touch, the extension in each browser, the command itself, your MCP
client's entry, and any directory you moved with `screenshotDir`, `downloadDir` or `skillsDir`.

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

`agent fix` was called `agent setup` before `setup` came to mean installing Browsentic. The old
spelling still works and is undocumented.

## MCP

| Command | Does |
| --- | --- |
| `browsentic mcp` | Serve MCP over stdio. What an [MCP client](../guide/mcp-clients.md) runs, not something you type |

`browsentic-mcp` is a legacy alias binary that serves MCP on bare invocation, so client
configurations written against the older name keep working.

## State and diagnostics

| Command | Does |
| --- | --- |
| `browsentic status` | The Bridge, which browsers can start it, the agent, and one row per paired browser with its extension version, its store and whether it is connected; flags an unpacked copy that needs ↻ and two copies answering in one browser |
| `browsentic logs` | Print the Bridge's log (`~/.browsentic/daemon.log`) |
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

`agent`, `skills`, `approvals`, `tasks` and `downloads` take `--json`. It is what the [macOS](../guide/mac-app.md) and
[Windows](../guide/windows-app.md) apps read, so an app and a terminal can never disagree about what is on disk.

## Lifecycle

| Command | Does |
| --- | --- |
| `browsentic start` | Bring the Bridge up in the background, if it is not already |
| `browsentic stop` | Stop the Bridge, whichever of 8765–8767 is answering. A paired browser leaves it stopped until `browsentic start`, or an MCP client, starts it |
| `browsentic restart` | Stop the Bridge and bring up a fresh one |
| `browsentic --version` / `-v` | Print the version |
| `browsentic help` / `--help` / `-h` | Usage |

**A rebuild does not replace a running Bridge.** It keeps the old code in memory until `stop` or
`restart`. In the repository, `yarn daemon:restart` chains the rebuild with the restart.

---

## Repository scripts

Scripts for a source checkout, not part of the CLI:

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
| `yarn win:app` | Build both halves, then the Windows app's installer around them (Windows, or macOS with `cargo-xwin`) |
| `yarn win:preview` | The Windows app's window in a browser, against a stand-in daemon |
| `yarn check:intent "<utterance>"` | Explain how one instruction would be routed |

Full list: [internals/contributing.md](../internals/contributing.md).
