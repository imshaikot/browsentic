# CLI reference

```
browsentic <command>
```

With no command it prints usage. Most commands start the daemon if one is not already running;
`status`, `stop`, `logs`, `token`, `tools`, `skills`, `approvals` and `downloads` do not.

---

## Installing

| Command | Does |
| --- | --- |
| `browsentic setup` | Install the extension, start the daemon, print a pairing code |
| `browsentic update` | Refresh the installed extension in place and restart the daemon |

`setup` writes the extension to `~/browsentic/extension/chrome-mv3` and leaves you two steps: load
that folder at `chrome://extensions` with Developer mode on, and paste the code into the popup.

The install path never carries a version, deliberately. Chrome derives an unpacked extension's ID
from the absolute path of its directory, and the daemon binds each session key to the resulting
origin, so a versioned path would unpair the browser on every update.

| Flag | Does |
| --- | --- |
| `--dir <path>` | Install somewhere else. Needed for Flatpak or Snap browsers, which cannot read `~/browsentic` without a filesystem grant |
| `--no-pair` | Install and start the daemon, mint no code |
| `--force` | Rewrite every file even when the installed build already matches |
| `--browser <name>` | `chrome` only for now. See [install](../guide/install.md) for the Firefox situation |
| `--json` | Machine-readable result |

See [guide/install.md](../guide/install.md).

## Pairing

| Command | Does |
| --- | --- |
| `browsentic pair` | Issue a one-time code to type into the extension popup. 8 characters, valid 10 minutes, single use |
| `browsentic sessions` | List paired browsers |
| `browsentic revoke [origin]` | Unpair one browser, or all of them |

See [guide/pair.md](../guide/pair.md).

## Agents

| Command | Does |
| --- | --- |
| `browsentic agent` | Show which agent runs the side panel, and which are installed |
| `browsentic agent <name>` | Switch to `claude`, `codex` or `antigravity` |
| `browsentic agent fix <name>` | Let Browsentic fix what that agent still needs |

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
| `browsentic downloads` | Files captured from pages, with notes and where they landed |
| `browsentic downloads clear` | Delete all of them |
| `browsentic token` | The control token, for MCP clients. Not for the browser |

## Lifecycle

| Command | Does |
| --- | --- |
| `browsentic stop` | Stop the background daemon |
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
| `yarn check:intent "<utterance>"` | Explain how one instruction would be routed |

Full list: [internals/contributing.md](../internals/contributing.md).
