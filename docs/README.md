# Browsentic documentation

Browsentic is an agentic browser harness: it runs the agent CLI you already use (Claude Code, Codex,
Cursor and others) from a side panel in your real, logged-in browser, and acts on the tab in front
of you. You instruct it by typing, by voice or by showing it a task once, and an optional MCP
endpoint lets other clients drive the same browser.

The docs are in three parts: the user guide, the internals and the reference.

## Using it

For running Browsentic on your own machine.

**[The user guide →](guide/)**

| | |
| --- | --- |
| [Install](guide/install.md) | One line sets up Browsentic Bridge, then the extension comes from your browser's store |
| [Pair](guide/pair.md) | Connecting a browser to Browsentic Bridge with a single-use code |
| [First run](guide/first-run.md) | A tour of the side panel and your first instruction |
| [Features](guide/features/) | One page per capability: what it does and when to use it |
| [Choosing an agent](guide/agents.md) | The eight agent CLIs the side panel can run on |
| [MCP clients](guide/mcp-clients.md) | Optional: drive the same browser from Claude Code, Cursor, Zed or Gemini CLI |
| [Configuration](guide/configuration.md) | Every key in `~/.browsentic/config.json` |
| [Approvals](guide/approvals.md) | Which actions wait for your approval, and how to change that |
| [Limits](guide/limits.md) | Where Browsentic does not fit; read it before you rely on it |
| [Troubleshooting](guide/troubleshooting.md) | Symptom → cause → fix |
| [Maintenance](guide/maintenance.md) | Updating and uninstalling |

## Building on it

How the parts work, for contributors and integrators.

**[Internals →](internals/)**

| | |
| --- | --- |
| [Overview](internals/overview.md) | Four processes, and why there is a daemon at all |
| [Transport](internals/transport.md) | Ports, the origin gate, the pairing handshake |
| [The action registry](internals/registry.md) | One definition, two bundles, and drift detection |
| [Request path](internals/request-path.md) | A tool call from an optional MCP client, end to end |
| [Inside the extension](internals/extension.md) | Background vs content script, tab scoping |
| [Agent runs](internals/agent-runs.md) | The intent funnel, runners, prompt assembly |
| [Guardrails](internals/guardrails.md) | The policy, run scope, fencing, spawn containment |
| [Subsystems](internals/subsystems.md) | Monitors, recordings, site maps, files, screenshots |
| [State on disk](internals/state.md) | What is written where, and at what mode |
| [Contributing](internals/contributing.md) | Build topology, checks, adding a capability |
| [Store listings](internals/stores.md) | Store IDs, submitting an update, what the dashboards ask for |

## Looking something up

**[Reference →](reference/)**

| | |
| --- | --- |
| [Tools](reference/tools.md) | All 52 page tools with their parameters, plus the resources |
| [CLI](reference/cli.md) | Every `browsentic` command |
| [Errors](reference/errors.md) | Every error code, what caused it, what to do |

---

To get started: [Install](guide/install.md) → [Pair](guide/pair.md) → [First run](guide/first-run.md).

The [project README](../README.md) is the short version.
