# Choosing an agent

The side panel runs on an agent CLI you already have logged in. Four are supported, and switching
is a click.

This is only about the **side panel**. Driving Browsentic *from* another tool is
[MCP clients](mcp-clients.md), and that direction is fully agent-agnostic.

---

## Picking one

In the extension popup, or behind the side panel's status pill. Each is listed with its state —
*ready*, *not installed*, *needs setup* — so a missing CLI is visible before you send an instruction
rather than after.

Each installed agent also carries a model select. *Default* runs whatever that CLI would run on its
own; picking a model is remembered per agent and applies from the next instruction. Unlike switching
agents, changing the model keeps the conversation being held open — every CLI resumes a session
under a new model.

The same thing from a terminal:

```sh
browsentic agent                  # what is installed, and what runs the side panel
browsentic agent codex            # switch
browsentic agent fix antigravity
```

Switching takes effect on the next instruction. It also drops the conversation being held open:
agents cannot resume each other's sessions, so the next instruction starts a fresh one.

---

## The four

| | Claude Code | Codex | Antigravity | Mistral Vibe (beta) |
| --- | --- | --- | --- | --- |
| Vendor | Anthropic | OpenAI | Google | Mistral AI |
| Binary | `claude` | `codex` | `agy` | `vibe` |
| Install | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` | [antigravity.google/docs/cli/install](https://antigravity.google/docs/cli/install) | `uv tool install mistral-vibe` |
| Default model | `claude-sonnet-5` | the CLI's own | the CLI's own | the CLI's own |
| Effort names | `low`…`max` | `low`…`xhigh` | `low`…`high` | none — set `thinking` in Vibe's own config |
| Kept off your machine by | a per-run tool allowlist plus an explicit deny list | a read-only sandbox (`sandbox_mode="read-only"`) | its own permission rules | a per-run tool allowlist — its shell and file tools are never loaded |

All four get the same system prompt, the same `browsentic` MCP server pointed back at the daemon,
and the same [approval gate](approvals.md). What differs is how well each one can be fenced off from
the rest of your machine — see [internals/guardrails.md § Spawn containment](../internals/guardrails.md#spawn-containment)
for exactly what each flag buys.

**Keep whichever you use reasonably current.** Browsentic passes flags that contain the run. A build
too old to understand them fails the run with an explicit "update it" message rather than running
uncontained.

### Mistral Vibe is in beta

It needs nothing set up beyond `vibe --setup` (or `MISTRAL_API_KEY` in `~/.vibe/.env`). Browsentic
writes a project config into the run's own folder under `~/.browsentic` — the `browsentic` MCP server
and an `always` permission for each of its tools — and starts Vibe there with `--trust`, so your
`~/.vibe/config.toml` is read for your key and models but never written.

Two things differ from the others. Vibe's headless stream carries whole messages, not tokens, so a
reply **arrives a message at a time** instead of being typed out. And it reports no token counts, so
the context card has none to show.

A model you pick has to be an alias your Vibe config defines; `mistral-medium-3.5` is the one it
ships with.

### Antigravity needs one permission rule

Headless `agy` soft-denies any MCP tool it has no rule for, which would refuse every browser action.
The popup shows this as *needs setup*.

Pressing the button — or `browsentic agent fix antigravity` — appends exactly one entry,
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
    "antigravity": { "bin": "agy" },
    "vibe": { "bin": "vibe" }
  }
}
```

| Key | Default | Effect |
| --- | --- | --- |
| `agent` | `claude` | Which CLI the side panel runs on. The agent picker writes this. |
| `agents.<name>.bin` | the CLI's own command name | Absolute path to the binary. Set this when the daemon's `PATH` differs from your shell's — the usual cause of `AGENT_MISSING`. |
| `agents.<name>.model` | `claude-sonnet-5` for Claude, otherwise the CLI's own default | Passed as `--model`. The picker's model select writes this. |
| `agents.<name>.effort` | unset | Passed as that CLI's reasoning-effort flag. A value the CLI does not accept is dropped rather than failing the run. |

Changes apply to the next run — the config is re-read each time, no daemon restart needed.

The pre-0.2 top-level `claudeBin`, `model` and `effort` keys are still honoured, and read as the
Claude runner's settings.

---

## Common problems

| Symptom | Fix |
| --- | --- |
| `AGENT_MISSING` | The daemon's `PATH` differs from your shell's. Set `agents.<name>.bin` to an absolute path. |
| `AGENT_NEEDS_PERMISSION` | Antigravity has no rule for Browsentic's tools. Press the button, or `browsentic agent fix antigravity`. |
| Codex: "not logged in" | The daemon inherits no session. Run `codex login`, then retry. |
| "does not understand the flags Browsentic uses" | The CLI is too old. Update it. |
| Antigravity answers but never touches the page | Its permission rule was removed. `browsentic agent` reports *needs setup* again. |

---

## See also

- [Configuration](configuration.md) — the rest of `config.json`
- [MCP clients](mcp-clients.md) — the other direction
- [internals/agent-runs.md](../internals/agent-runs.md) — how a run is actually spawned and streamed
