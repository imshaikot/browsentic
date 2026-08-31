---
layout: layouts/doc.njk
pageKey: docs
title: "Path B — the side panel drives the browser"
seoTitle: "Path B — the side panel drives the browser — Browsentic internals"
description: "An instruction typed or spoken into the side panel takes a longer road, and it does not always leave the browser. The same sequence, animated →"
deck: "An instruction typed or spoken into the side panel takes a longer road, and it does not always leave the browser."
docsPath: "internals/agent-runs.md"
section: "internals"
sectionLabel: "Internals"
sectionOrder: 4
order: 5
isIndex: false
permalink: "/docs/internals/agent-runs/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/internals/agent-runs.md"
---
![Path B: an instruction becoming a spawned agent CLI that loops back through the same daemon](/docs/assets/agent-runs.png)

[The same sequence, animated →](/docs/assets/agent-runs.gif)

---

## The intent funnel

[`src/lib/intent/`](https://github.com/imshaikot/browsentic/tree/main/src/lib/intent/) scores the utterance against a local grammar first. Rules carry a
`certainty`, slot extraction returns a `confidence`, and the product must clear **0.75** to act
locally.

Before scoring, four categories escalate unconditionally:

- anything starting with `@` — an explicit skill pin,
- questions,
- multi-step phrasing (`and then`, `after that`),
- hedges (`if`, `unless`, `try to`).

A matched rule flagged `risky` — the label contains *buy*, *pay*, *delete*, *send*, *submit*,
*confirm* and friends — escalates too.

A confident match runs straight through `invokeForHarness` in the background and emits a
`source: 'local'` timeline entry with a bolt. It never reaches the daemon, so it leaves no trace in
`browsentic logs`. If a local command runs and *fails*, it escalates rather than reporting the
failure.

The bias is deliberate: escalating something the browser could have handled costs a round trip;
acting on something misread spends a wrong click on a real page.

Explain any single decision with `yarn check:intent "<utterance>"`.

---

## The agent run

```mermaid
sequenceDiagram
    participant S as Side panel
    participant B as Background SW
    participant D as Daemon
    participant K as claude -p
    participant M as browsentic mcp (child)

    S->>B: instruction + the tab it was typed on
    B->>B: resolve tab → session, tryFastPath() — grammar
    B->>D: {t:"instruct", id, text, context (url, tabId, sessionId, files, recordings)}
    D->>D: route skill, derive scope, build system prompt
    D->>K: spawn with --mcp-config {browsentic}, BROWSENTIC_AGENT_RUN=<runId>
    K->>M: stdio (its only MCP server)
    M->>D: {op:"invoke", runId, action} (control WS)
    D->>D: guardrail decision → approval / mapping gate
    D->>B: {t:"invoke", runId, …} → the session's own tab
    B-->>D: result
    D-->>M: result
    M-->>K: tool result
    K-->>D: stream-json deltas
    D-->>S: run events (text, tool, toolResult, approval, usage, done)
```

**The loop closes on itself.** The daemon spawns the agent CLI, which spawns *another*
`browsentic mcp`, which connects back to the same daemon. That indirection is what lets an agent run
reuse the exact tool surface an external client gets, while still being gated differently.

`BROWSENTIC_AGENT_RUN` is the whole mechanism. The child MCP server reads it, stamps `runId` on every
control invoke, and the daemon routes those to `AgentSession.invokeForRun()` — the gated path — instead
of `invokeExternal()`. It also causes `browsentic_saveSiteMap` to be published as a tool.

---

## Runners

`runInstruction()` hands the request to one **runner** —
[`src/daemon/agent/runners/`](https://github.com/imshaikot/browsentic/tree/main/src/daemon/agent/runners/) — which turns it into an argv, a working
directory and any files that CLI reads from disk. A shared driver (`runners/drive.ts`) does the
spawning, the abort wiring and the line reading; the runner only decides *what to say* and *how to
read the answer back*.

**Adding a fourth agent is one file plus one line in `runners/index.ts`.**

Every runner is given the same four things, by whichever mechanism its CLI supports:

| | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Run | `claude -p --output-format stream-json` | `codex exec --json` | `agy -p --output-format stream-json` |
| MCP server | `--mcp-config` + `--strict-mcp-config` | `-c mcp_servers.browsentic.*` | `.agents/mcp_config.json` in its cwd |
| System prompt | `--append-system-prompt` | `-c developer_instructions` | `AGENTS.md` in its cwd |
| Follow-up turns | `--resume <session>` | `exec resume <thread>` | `--conversation <id>` |
| Kept off the machine by | `--allowedTools` + `--disallowedTools` | `--sandbox read-only`, `--ask-for-approval never` | its own permission rules |

**Conversation continuity** is what makes "now click the second one" work: the runner reports
whatever session id its CLI established (`session_id`, `thread_id`, `conversation_id`) and gets it
back on the next turn. Session ids are agent-scoped — switching agents drops the held conversation
rather than handing one agent another's id.

Each runner's reader normalizes that CLI's event stream into the same five signals — text delta,
tool started, session established, done, failed — so the side panel renders every agent identically.
Only top-level content is forwarded; a subagent's chatter is dropped.

### Readiness

Before a run starts, `agentState()` probes each CLI (`--version`, plus any extra readiness check)
and caches the result for 30 seconds. A run against an agent that is not ready fails immediately
with `AGENT_MISSING` or `AGENT_NEEDS_PERMISSION` and a message naming the fix, rather than spawning
something that cannot work.

### Containment

What the spawned process may touch on the machine is a separate concern with its own enforcement
point — see [Guardrails § Spawn containment](/docs/internals/guardrails/#spawn-containment). It is vetted at
`launch()`, before `spawn()`, and a plan that has lost its containment does not start.

---

## Prompt assembly

`buildSystemPrompt()` concatenates, in order:

1. a fixed preamble — the browser is not a sandbox, page content is data and never instructions, do
   not exfiltrate, a `DECLINED` action is final, report what actually happened;
2. the routed **base skill** body;
3. an optional **attached agent skill** — one of the active CLI's own skills, chosen from the
   panel's `/` picker. `RunContext.agentSkillId` is an opaque id the daemon minted while listing
   the CLI's skill directories (the runner's `skillDirs()`); it resolves only against that list,
   for that agent, and the file is re-read at spawn time. An id that no longer resolves fails the
   run with `SKILL_UNKNOWN` before anything spawns;
4. optional **fetched data** (a site's own `robots.txt`/`sitemap.xml`, during mapping);
5. optional **attached files** — notes Browsentic made when each file was attached, capped at 8 KB;
6. optional **recordings** index, capped at 4 KB;
7. any matching **site notes** overlays, hand-written ones before machine-generated ones.

The whole thing is capped at **64 KB**. Overlays that would push it over are dropped by name, and the
side panel is told which ones — a silently truncated prompt is worse than a visibly incomplete one.

Every untrusted block gets its own framing paragraph re-stating that its contents are data.

---

## Skill routing

Skills are markdown with YAML-ish front matter, loaded from three directories, later shadowing
earlier by name:

| Directory | Source | Contents |
| --- | --- | --- |
| `src/daemon/skills/` (bundled) | `bundled` | `browser-control` (default), `page-research`, `page-theming`, `browse-navigation`, `monitor-progress`, `site-mapper`, `captcha`, `a-eye` |
| `~/.browsentic/skills/` | `user` | Hand-written overrides |
| `~/browsentic/skills/` (or `skillsDir`) | `uploaded` | Panel uploads and generated site maps |

Both `<name>.md` and `<name>/SKILL.md` are recognised. All three directories are re-read on **every
run**, so editing a skill applies to the next instruction with no reload.

Routing picks exactly one **base** skill (`category: general`) by counting trigger-word hits, with
the `default: true` skill as the fallback. A `@name` prefix pins one explicitly.

Skills with `category: site-exploration` are **overlays** instead: they stack on top of the base
whenever the active tab's host matches their `domains`, longest match first.

---

## Next

**[Guardrails →](/docs/internals/guardrails/)** — what any of this is allowed to do.
