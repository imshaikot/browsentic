---
layout: layouts/doc.njk
pageKey: docs
title: "Internals"
seoTitle: "Internals — Browsentic internals"
description: "How an instruction becomes a click, end to end. Browsentic is four processes cooperating over loopback: a browser extension, a local daemon, one stdio MCP…"
deck: "How an instruction becomes a click, end to end."
docsPath: "internals/README.md"
section: "internals"
sectionLabel: "Internals"
sectionOrder: 4
order: -1
isIndex: true
permalink: "/docs/internals/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/internals/README.md"
---
![The ten chapters as one request's path through all four processes](/docs/assets/internals-map.png)

Browsentic is four processes cooperating over loopback: a browser extension, a local daemon, one
stdio MCP server per client, and — when the side panel is driving — a headless agent CLI.

Read in order, these pages follow a request through all of them:

| | |
| --- | --- |
| **1.** [Overview](/docs/internals/overview/) | The four processes, and why a Manifest V3 extension forces a daemon |
| **2.** [Transport](/docs/internals/transport/) | Ports, the `Origin` gate, the mutual pairing handshake, protocol versioning |
| **3.** [The action registry](/docs/internals/registry/) | One definition compiled into two bundles; names, drift detection, reserved actions |
| **4.** [Request path](/docs/internals/request-path/) | Path A — an MCP client's tool call reaching the page |
| **5.** [Inside the extension](/docs/internals/extension/) | Background vs content script, self-healing injection, tab scoping |
| **6.** [Agent runs](/docs/internals/agent-runs/) | Path B — the intent funnel, the spawned CLI, prompt assembly, skill routing |
| **7.** [Guardrails](/docs/internals/guardrails/) | The declarative policy, run scope, result fencing, spawn containment |
| **8.** [Subsystems](/docs/internals/subsystems/) | Monitors, recordings, site maps, files, screenshots |
| **9.** [State on disk](/docs/internals/state/) | Every file Browsentic writes, and why it is where it is |
| **10.** [Contributing](/docs/internals/contributing/) | Build topology, the checks, and adding a capability |

Looking for an error code? [reference/errors.md](/docs/reference/errors/).

Looking for a tool's parameters? [reference/tools.md](/docs/reference/tools/).
