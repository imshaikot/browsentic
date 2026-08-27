---
layout: layouts/doc.njk
pageKey: docs
title: "Choosing an agent"
seoTitle: "Choosing an agent — Browsentic user guide"
description: "The side panel runs on an agent CLI you already have logged in. Three are supported, and switching is a click. This is only about the side panel. Driving…"
deck: "The side panel runs on an agent CLI you already have logged in. Three are supported, and switching is a click."
docsPath: "guide/agents.md"
section: "guide"
sectionLabel: "User guide"
sectionOrder: 1
order: 3
isIndex: false
permalink: "/docs/guide/agents/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/agents.md"
---
This is only about the **side panel**. Driving Browsentic *from* another tool is
[MCP clients](/docs/guide/mcp-clients/), and that direction is fully agent-agnostic.

---

## Picking one

In the extension popup, or behind the side panel's status pill. Each is listed with its state —
*ready*, *not installed*, *needs setup* — so a missing CLI is visible before you send an instruction
rather than after.

The same thing from a terminal:

```sh
browsentic-mcp agent                  # what is installed, and what runs the side panel
browsentic-mcp agent codex            # switch
browsentic-mcp agent setup antigravity
```

Switching takes effect on the next instruction. It also drops the conversation being held open:
agents cannot resume each other's sessions, so the next instruction starts a fresh one.

---

## The three

| | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Vendor | Anthropic | OpenAI | Google |
| Binary | `claude` | `codex` | `agy` |
| Install | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` | [antigravity.google/docs/cli/install](https://antigravity.google/docs/cli/install) |
| Default model | `claude-sonnet-5` | the CLI's own | the CLI's own |
| Effort names | `low`…`max` | `minimal`…`high` | `low`…`high` |
| Kept off your machine by | a per-run tool allowlist plus an explicit deny list | `--sandbox read-only` | its own permission rules |

All three get the same system prompt, the same `browsentic` MCP server pointed back at the daemon,
and the same [approval gate](/docs/guide/approvals/). What differs is how well each one can be fenced off from
the rest of your machine — see [internals/guardrails.md § Spawn containment](/docs/internals/guardrails/#spawn-containment)
for exactly what each flag buys.

**Keep whichever you use reasonably current.** Browsentic passes flags that contain the run. A build
too old to understand them fails the run with an explicit "update it" message rather than running
uncontained.

### Antigravity needs one permission rule

Headless `agy` soft-denies any MCP tool it has no rule for, which would refuse every browser action.
The popup shows this as *needs setup*.

Pressing the button — or `browsentic-mcp agent setup antigravity` — appends exactly one entry,
`mcp(browsentic/*)`, to `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`, leaving
the rest of that file alone. Nothing is written until you press it. If you have a `deny` rule
covering the same tools, Browsentic will not overrule it — remove it yourself.

---

## Per-agent settings

In `~/.browsentic/config.json`:

```json
{
  "agent": "claude",
  "agents": {
    "claude": { "bin": "/opt/homebrew/bin/claude", "model": "claude-sonnet-5", "effort": "high" },
    "codex": { "bin": "codex", "model": "gpt-5.6-terra" },
    "antigravity": { "bin": "agy" }
  }
}
```

| Key | Default | Effect |
| --- | --- | --- |
| `agent` | `claude` | Which CLI the side panel runs on. The agent picker writes this. |
| `agents.<name>.bin` | the CLI's own command name | Absolute path to the binary. Set this when the daemon's `PATH` differs from your shell's — the usual cause of `AGENT_MISSING`. |
| `agents.<name>.model` | `claude-sonnet-5` for Claude, otherwise the CLI's own default | Passed as `--model`. |
| `agents.<name>.effort` | unset | Passed as that CLI's reasoning-effort flag. A value the CLI does not accept is dropped rather than failing the run. |

Changes apply to the next run — the config is re-read each time, no daemon restart needed.

The pre-0.2 top-level `claudeBin`, `model` and `effort` keys are still honoured, and read as the
Claude runner's settings.

---

## Common problems

| Symptom | Fix |
| --- | --- |
| `AGENT_MISSING` | The daemon's `PATH` differs from your shell's. Set `agents.<name>.bin` to an absolute path. |
| `AGENT_NEEDS_PERMISSION` | Antigravity has no rule for Browsentic's tools. Press the button, or `browsentic-mcp agent setup antigravity`. |
| Codex: "not logged in" | The daemon inherits no session. Run `codex login`, then retry. |
| "does not understand the flags Browsentic uses" | The CLI is too old. Update it. |
| Antigravity answers but never touches the page | Its permission rule was removed. `browsentic-mcp agent` reports *needs setup* again. |

---

## See also

- [Configuration](/docs/guide/configuration/) — the rest of `config.json`
- [MCP clients](/docs/guide/mcp-clients/) — the other direction
- [internals/agent-runs.md](/docs/internals/agent-runs/) — how a run is actually spawned and streamed
