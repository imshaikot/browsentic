# Browsentic documentation

Browsentic hands your real, logged-in browser to the AI agent you already run — by voice, by
typing, or by showing it once — and turns that into real actions on the tab in front of you.

The docs are split by who is asking.

## Using it

Start here if you want to run Browsentic on your own machine.

**[The user guide →](guide/)**

| | |
| --- | --- |
| [Install](guide/install.md) | Prerequisites, clone, build, load the extension |
| [Pair](guide/pair.md) | Put the CLI on your `PATH` and connect your browser |
| [First run](guide/first-run.md) | A tour of the side panel and your first instruction |
| [Features](guide/features/) | One page per capability — what it does and when to reach for it |
| [Choosing an agent](guide/agents.md) | Claude Code, Codex or Antigravity |
| [MCP clients](guide/mcp-clients.md) | Drive the same browser from Claude Code, Cursor, Zed, Gemini CLI |
| [Configuration](guide/configuration.md) | Every key in `~/.browsentic/config.json` |
| [Approvals](guide/approvals.md) | What asks before it acts, and how to change that |
| [Limits](guide/limits.md) | Where Browsentic does not fit — read before you rely on it |
| [Troubleshooting](guide/troubleshooting.md) | Symptom → cause → fix |
| [Maintenance](guide/maintenance.md) | Updating and uninstalling |

## Building on it

How the pieces actually work, for contributors and for anyone integrating.

**[Internals →](internals/)**

| | |
| --- | --- |
| [Overview](internals/overview.md) | Four processes, and why there is a daemon at all |
| [Transport](internals/transport.md) | Ports, the origin gate, the pairing handshake |
| [The action registry](internals/registry.md) | One definition, two bundles, and drift detection |
| [Request path](internals/request-path.md) | An MCP tool call, end to end |
| [Inside the extension](internals/extension.md) | Background vs content script, tab scoping |
| [Agent runs](internals/agent-runs.md) | The intent funnel, runners, prompt assembly |
| [Guardrails](internals/guardrails.md) | The policy, run scope, fencing, spawn containment |
| [Subsystems](internals/subsystems.md) | Monitors, recordings, site maps, files, screenshots |
| [State on disk](internals/state.md) | What is written where, and at what mode |
| [Contributing](internals/contributing.md) | Build topology, checks, adding a capability |

## Looking something up

**[Reference →](reference/)**

| | |
| --- | --- |
| [Tools](reference/tools.md) | All 41 MCP tools with their parameters, plus the resources |
| [CLI](reference/cli.md) | Every `browsentic` command |
| [Errors](reference/errors.md) | Every error code, what caused it, what to do |

---

New here? [Install](guide/install.md) → [Pair](guide/pair.md) → [First run](guide/first-run.md).

The [project README](../README.md) is the two-minute version of all of it.
