---
layout: layouts/doc.njk
pageKey: docs
title: "CLI reference"
seoTitle: "CLI reference — Browsentic reference"
description: "With no command it serves MCP over stdio — that is what an MCP client runs, and it is not something you type yourself."
deck: ""
docsPath: "reference/cli.md"
section: "reference"
sectionLabel: "Reference"
sectionOrder: 3
order: 1
isIndex: false
permalink: "/docs/reference/cli/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/reference/cli.md"
---
```
browsentic-mcp <command>
```

With no command it serves MCP over stdio — that is what an [MCP client](/docs/guide/mcp-clients/)
runs, and it is not something you type yourself.

Every command starts the daemon if one is not already running.

---

## Pairing

| Command | Does |
| --- | --- |
| `browsentic-mcp pair` | Issue a one-time code to type into the extension popup. 8 characters, valid 10 minutes, single use |
| `browsentic-mcp sessions` | List paired browsers |
| `browsentic-mcp revoke [origin]` | Unpair one browser, or all of them |

See [guide/pair.md](/docs/guide/pair/).

## Agents

| Command | Does |
| --- | --- |
| `browsentic-mcp agent` | Show which agent runs the side panel, and which are installed |
| `browsentic-mcp agent <name>` | Switch to `claude`, `codex` or `antigravity` |
| `browsentic-mcp agent setup <name>` | Let Browsentic fix what that agent still needs |

`agent setup antigravity` appends exactly one entry, `mcp(browsentic/*)`, to `permissions.allow` in
`~/.gemini/antigravity-cli/settings.json`. See [guide/agents.md](/docs/guide/agents/).

## State and diagnostics

| Command | Does |
| --- | --- |
| `browsentic-mcp status` | Daemon and extension connection state, manifest sync, pairing count |
| `browsentic-mcp logs` | Print the daemon log (`~/.browsentic/daemon.log`) |
| `browsentic-mcp tools` | Print the bundled tool manifest as JSON. **No browser needed** |
| `browsentic-mcp skills` | Every skill the router can see, tagged `bundled`, `user` or `uploaded` |
| `browsentic-mcp approvals` | The "always on this site" grants |
| `browsentic-mcp approvals clear [host]` | Forget them — all, or one site's |
| `browsentic-mcp token` | The control token, for MCP clients. Not for the browser |

## Lifecycle

| Command | Does |
| --- | --- |
| `browsentic-mcp stop` | Stop the background daemon |
| `browsentic-mcp restart` | Stop the daemon and bring up a fresh one |
| `browsentic-mcp --version` / `-v` | Print the version |
| `browsentic-mcp help` / `--help` / `-h` | Usage |

**A rebuild does not replace a running daemon.** It keeps the old code in memory until `stop` or
`restart`. In the repository, `yarn mcp:restart` chains the rebuild with the restart.

---

## Repository scripts

Not the CLI, but frequently wanted alongside it:

| Command | Does |
| --- | --- |
| `yarn setup` | Install and build both halves |
| `yarn mcp:link` | Put `browsentic-mcp` on your `PATH` |
| `yarn mcp:unlink` | Take it off again |
| `yarn mcp:restart` | Rebuild the daemon, then swap the running one for it |
| `yarn mcp:manifest` | Build and print the tool manifest |
| `yarn check` | Both type checks plus both fixture suites |
| `yarn check:intent "<utterance>"` | Explain how one instruction would be routed |

Full list: [internals/contributing.md](/docs/internals/contributing/).
