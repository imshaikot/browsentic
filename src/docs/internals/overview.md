---
layout: layouts/doc.njk
pageKey: docs
title: "Overview"
seoTitle: "Overview — Browsentic internals"
description: "Browsentic is four processes cooperating over loopback. A Manifest V3 service worker cannot listen for connections. It can only dial out, and it is killed…"
deck: "Browsentic is four processes cooperating over loopback."
docsPath: "internals/overview.md"
section: "internals"
sectionLabel: "Internals"
sectionOrder: 4
order: 0
isIndex: false
permalink: "/docs/internals/overview/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/internals/overview.md"
---
![Four processes over loopback: the extension, the daemon, the spawned agent CLI, and any MCP client](/docs/assets/overview.png)

---

## Why there is a daemon at all

A Manifest V3 service worker cannot listen for connections. It can only dial out, and it is killed
and revived at the browser's discretion. So the extension is a *client*, and something outside the
browser has to be the meeting point.

That something is the daemon. It owns exactly one live browser link and fans it out to however many
MCP clients want a turn:

```
You ──speak or type──> Extension ──local WebSocket──> Daemon ──spawns──> your agent CLI
                            ▲                                        (claude │ codex │ agy)
                            └──────────────── page actions ─────────────────────┘

Any MCP client ──stdio──> browsentic-mcp ──> the same daemon ──> the same browser
```

Everything binds to `127.0.0.1`. Nothing listens on a public interface, and there is no cloud
component.

---

## The four processes

| Process | Started by | Lives for | Job |
| --- | --- | --- | --- |
| **Extension** | The browser | As long as the browser runs | Owns the tabs. Runs the side panel, the popup, the background service worker and one content script per page |
| **Daemon** (`daemon-main.js`) | Auto-spawned by the first CLI or MCP client that needs it | Until 30 minutes idle with no extension and no control clients | Owns the browser link, authorization, agent runs, screenshot writes, skill and site-map storage |
| **MCP server** (`browsentic-mcp`) | The MCP client, over stdio | The client's session | Translates MCP tool calls into daemon control frames. One process per client |
| **Agent** (`claude -p` and friends) | The daemon, per side-panel instruction | One instruction | Reasons about the instruction and calls page tools. Contained to Browsentic's own MCP server |

The MCP server is deliberately thin: it holds **no browser state**. Kill it and the browser link is
untouched, because the link belongs to the daemon.

The daemon has no start command. The first CLI or MCP client that needs it spawns it. That is also
why a rebuild alone changes nothing while one is running — see
[Contributing](/docs/internals/contributing/#the-daemon-keeps-the-old-build-in-memory).

---

## The two paths through it

Everything in this section is one of two request shapes:

| | |
| --- | --- |
| **[Path A](/docs/internals/request-path/)** | An MCP client calls a tool. Thin, unconditional, no agent involved on Browsentic's side |
| **[Path B](/docs/internals/agent-runs/)** | You type into the side panel. Goes through the intent funnel, then possibly spawns an agent CLI which loops back through Path A |

Path B closing back onto Path A is the central trick: the agent the daemon spawns runs *another*
`browsentic-mcp`, which connects back to the same daemon. That is what lets an agent run reuse the
exact tool surface an external client gets while still being [gated differently](/docs/internals/guardrails/).

---

## Next

**[Transport →](/docs/internals/transport/)** — how anything gets to connect in the first place.
