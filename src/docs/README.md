---
layout: layouts/doc.njk
pageKey: docs
title: "Browsentic documentation"
seoTitle: "Browsentic documentation: install, pair and automate any browser tab"
description: "Browsentic hands your real, logged-in browser to the AI agent you already run — by voice, by typing, or by showing it once — and turns that into real actions…"
deck: "Browsentic hands your real, logged-in browser to the AI agent you already run — by voice, by typing, or by showing it once — and turns that into real actions on the tab in front of you."
docsPath: "README.md"
section: ""
sectionLabel: "Overview"
sectionOrder: 0
order: -1
isIndex: true
permalink: "/docs/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/README.md"
---
The docs are split by who is asking.

## Using it

Start here if you want to run Browsentic on your own machine.

**[The user guide →](/docs/guide/)**

| | |
| --- | --- |
| [Install](/docs/guide/install/) | Prerequisites, clone, build, load the extension |
| [Pair](/docs/guide/pair/) | Put the CLI on your `PATH` and connect your browser |
| [First run](/docs/guide/first-run/) | A tour of the side panel and your first instruction |
| [Features](/docs/guide/features/) | One page per capability — what it does and when to reach for it |
| [Choosing an agent](/docs/guide/agents/) | Claude Code, Codex or Antigravity |
| [MCP clients](/docs/guide/mcp-clients/) | Drive the same browser from Claude Code, Cursor, Zed, Gemini CLI |
| [Configuration](/docs/guide/configuration/) | Every key in `~/.browsentic/config.json` |
| [Approvals](/docs/guide/approvals/) | What asks before it acts, and how to change that |
| [Limits](/docs/guide/limits/) | Where Browsentic does not fit — read before you rely on it |
| [Troubleshooting](/docs/guide/troubleshooting/) | Symptom → cause → fix |
| [Maintenance](/docs/guide/maintenance/) | Updating and uninstalling |

## Building on it

How the pieces actually work, for contributors and for anyone integrating.

**[Internals →](/docs/internals/)**

| | |
| --- | --- |
| [Overview](/docs/internals/overview/) | Four processes, and why there is a daemon at all |
| [Transport](/docs/internals/transport/) | Ports, the origin gate, the pairing handshake |
| [The action registry](/docs/internals/registry/) | One definition, two bundles, and drift detection |
| [Request path](/docs/internals/request-path/) | An MCP tool call, end to end |
| [Inside the extension](/docs/internals/extension/) | Background vs content script, tab scoping |
| [Agent runs](/docs/internals/agent-runs/) | The intent funnel, runners, prompt assembly |
| [Guardrails](/docs/internals/guardrails/) | The policy, run scope, fencing, spawn containment |
| [Subsystems](/docs/internals/subsystems/) | Monitors, recordings, site maps, files, screenshots |
| [State on disk](/docs/internals/state/) | What is written where, and at what mode |
| [Contributing](/docs/internals/contributing/) | Build topology, checks, adding a capability |

## Looking something up

**[Reference →](/docs/reference/)**

| | |
| --- | --- |
| [Tools](/docs/reference/tools/) | All 41 MCP tools with their parameters, plus the resources |
| [CLI](/docs/reference/cli/) | Every `browsentic-mcp` command |
| [Errors](/docs/reference/errors/) | Every error code, what caused it, what to do |

---

New here? [Install](/docs/guide/install/) → [Pair](/docs/guide/pair/) → [First run](/docs/guide/first-run/).

The [project README](https://github.com/imshaikot/browsentic/blob/main/README.md) is the two-minute version of all of it.
