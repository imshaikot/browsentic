# Choosing an agent

The side panel runs on an agent CLI you already have logged in. Seven are supported — Mistral Vibe,
Grok Build, Cursor CLI and Qwen Code in beta — and switching is a click.

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

## The seven

| | Claude Code | Codex | Antigravity | Mistral Vibe (beta) | Grok Build (beta) | Cursor CLI (beta) | Qwen Code (beta) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vendor | Anthropic | OpenAI | Google | Mistral AI | xAI | Anysphere | Alibaba |
| Binary | `claude` | `codex` | `agy` | `vibe` | `grok` | `cursor-agent` | `qwen` |
| Install | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` | [antigravity.google/docs/cli/install](https://antigravity.google/docs/cli/install) | `uv tool install mistral-vibe` | `curl -fsSL https://x.ai/cli/install.sh \| bash` | `curl https://cursor.com/install -fsS \| bash` | `npm i -g @qwen-code/qwen-code` |
| Default model | `claude-sonnet-5` | the CLI's own | the CLI's own | the CLI's own | the CLI's own | the CLI's own | the CLI's own |
| Effort names | `low`…`max` | `low`…`xhigh` | `low`…`high` | none — set `thinking` in Vibe's own config | `low`…`xhigh` | none — put it in the model id, e.g. `claude-opus-4-8[effort=high]` | none — the model id is the only lever |
| Kept off your machine by | a per-run tool allowlist plus an explicit deny list | a read-only sandbox (`sandbox_mode="read-only"`) | its own permission rules | a per-run tool allowlist — its shell and file tools are never loaded | a per-run tool list, approvals that refuse anything not granted up front, and a kernel sandbox that keeps its writes in its own folder | per-run deny rules, where a deny beats every allow; a kernel sandbox is asked for too but not depended on | `--safe-mode`, which drops every setting of your own, plus deny rules for the shell, the disk and the tools that reach either |

All seven get the same system prompt, the same `browsentic` MCP server pointed back at the daemon,
and the same [approval gate](approvals.md). What differs is how well each one can be fenced off from
the rest of your machine — see [internals/guardrails.md § Spawn containment](../internals/guardrails.md#spawn-containment)
for exactly what each flag buys.

**Keep whichever you use reasonably current.** Browsentic passes flags that contain the run. A build
too old to understand them fails the run with an explicit "update it" message rather than running
uncontained.

### Codex keeps the browser tools out of sight

Codex does not put an MCP server's tools in the model's list. They are deferred behind its
`tool_search`, and on a code-mode model (`gpt-5.6-terra` and the like) they exist only inside its
`exec` sandbox. Left to itself, a model answers a question about the page from the tools it *can*
see — its own memory, or a web search — without ever looking at your browser.

So a Codex run is given a section of prompt saying where its browser tools are and how to load them,
and it is told to read the page rather than recall it. Web search is switched off unless the run is
[mapping a site](features/site-maps.md), and sub-agents, goal memory, connector apps and plugin suggestions
are switched off for good measure.

**Codex cuts a tool result at 10,000 tokens** by default, which a whole-page snapshot can pass.
Browsentic raises that to 25,000, the ceiling Claude Code puts on the same result. A code-mode model
also has to ask for it at the top of every `exec` script, which the prompt tells it to do. A result
past 25,000 is still cut, so the prompt asks for smaller reads too.

### Mistral Vibe is in beta

It needs nothing set up beyond `vibe --setup` (or `MISTRAL_API_KEY` in `~/.vibe/.env`). Browsentic
writes a project config into the conversation's own folder under `~/.browsentic` — the `browsentic`
MCP server and an `always` permission for each of its tools — and starts Vibe there with `--trust`,
so your `~/.vibe/config.toml` is read for your key and models but never written. One folder per
conversation, rewritten each turn, because Vibe re-reads a resumed session from the folder it began
in rather than the one it is started in.

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

### Grok Build is in beta

Browsentic's Grok runner was checked against `grok` 1.0.40 up to the model's first reply: every
flag it passes, the containment, the browser tools reaching a run, and each error Grok reports. A
whole conversation has not been run end to end yet, because the account it was built on was
rate-limited before the model answered. Expect rough edges, and please report them.

- **Sign in first.** Run `grok login`, or set `XAI_API_KEY`. Until then the popup shows *needs setup*.
- **A free Grok account is rate-limited.** Grok retries quietly for several minutes before it gives
  up, so a run can sit silent that long before it fails with *xAI did not answer*.
- **It stays out of your other tools.** Grok normally loads Claude Code's and Cursor's MCP servers
  and keeps a memory across sessions. A Browsentic run switches both off, so a page cannot reach
  those servers or leave anything behind for your next Grok session. MCP servers you set up in
  Grok itself still load; see [Spawn containment](../internals/guardrails.md#spawn-containment).

---

### Cursor CLI is in beta

Browsentic's Cursor runner was checked against `cursor-agent 2026.09.18-9a7762b`: every flag it
passes is accepted, a real turn was read back from its stream, and the deny rules were measured
refusing a shell command in a headless run. What has not been through it yet is a whole
conversation in the side panel — the browser tools reaching a page, and a follow-up turn resuming.
Expect rough edges there, and please report them.

- **Sign in first.** Run `cursor-agent login`, or set `CURSOR_API_KEY`. Until then a run fails with
  *Authentication required*.
- **Your own Cursor MCP servers are denied by name.** A project config does not replace the global
  `~/.cursor/mcp.json`, so every server you configured for Cursor itself would otherwise load
  beside Browsentic's — including your own `browsentic` entry, which reaches the browser without a
  run's approval gate. Browsentic reads that file and denies each of them for the run. It never
  writes to it.
- **Reasoning effort goes in the model id.** Cursor has no effort flag; it takes bracket overrides
  instead, so set `agents.cursor.model` to something like `claude-opus-4-8[effort=high]`.
- **On Windows, only the deny rules apply.** Cursor's kernel sandbox is macOS and Linux only.
- **Each conversation leaves an entry in `~/.cursor/projects`.** Cursor records a project per
  directory it is run in, and Browsentic gives each conversation its own. They are swept with the
  conversation's workspace after a day.

---

### Qwen Code is in beta

Browsentic's Qwen runner was written against `qwen-code` 0.24.4's own source rather than against a
running binary: no Qwen provider was configured on the machine it was built on, so nothing here has
been through a real turn. The flags, the stream shapes and the containment all come from the repo.
Expect rough edges, and please report them.

- **Configure a provider first.** Qwen OAuth's free tier ended on 2026-04-15 and its requests are
  now rejected, so "install it and log in" is no longer enough. Run `qwen` and use `/auth`, or
  export `OPENAI_API_KEY` with `OPENAI_BASE_URL` pointed at your endpoint. Until then the popup
  says *needs setup* and a run fails with *No auth type is selected*.
- **Only some keys reach a run.** Browsentic keeps `QWEN_*`, `DASHSCOPE_*`, `BAILIAN_*` and
  `OPENAI_*` in the run's environment and seals the rest away, so the `anthropic` and `gemini` auth
  types Qwen also accepts will not find their keys. That is deliberate: handing one vendor's agent
  another vendor's credential is what [sealing](../internals/guardrails.md#the-environment-a-run-sees)
  exists to prevent.
- **Every setting of your own is switched off for the run.** Browsentic passes `--safe-mode`, which
  drops your hooks, extensions, bundled skills, `settings.json` MCP servers, `.mcp.json` and
  permission rules, and passes its own MCP server as an explicit argument instead. Your own
  `browsentic` entry cannot load beside it, and nothing you configured for Qwen widens a run.
- **The bundled browser-use and computer-use skills are denied.** Qwen ships a skill that drives
  your Chrome through an extension of its own — a second browser Browsentic never sees — and one
  that runs `qwen mcp add` and `npm install` by itself on first use. Both reach the model through
  the `skill` tool, which a run does not get. The side panel's `/` picker still lists your own
  skills from `~/.qwen/skills` and `~/.agents/skills`; it reads them off disk itself.
- **The run is stopped if the deny list did not take.** Qwen prints every tool and MCP server that
  actually registered, and Browsentic reads that line back before the model has spoken. Anything it
  did not ask for ends the run with `AGENT_UNSAFE` rather than letting it act.
- **Reasoning effort has no flag.** Set `agents.qwen.model` instead.
- **Two things sealing does not cover.** Qwen loads the first `.env` it finds walking up from its
  working directory, then `~/.qwen/.env` and `~/.env`, for variables not already set — so a key
  Browsentic sealed away can come back from disk. It reaches the model provider, not the model,
  because the shell and file tools are denied. And an `@path` in what you type is expanded by Qwen
  into the prompt before the run starts, which reads a file without a tool call; that is your own
  typed text, but it is worth knowing.

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
    "vibe": { "bin": "vibe" },
    "grok": { "bin": "grok", "model": "grok-4.7" },
    "cursor": { "bin": "cursor-agent", "model": "composer-2.5" },
    "qwen": { "bin": "qwen", "model": "qwen3-coder-plus" }
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
| `AGENT_NEEDS_PERMISSION` | Antigravity has no rule for Browsentic's tools: press the button, or `browsentic agent fix antigravity`. Grok Build is not signed in: run `grok login`. Qwen Code has no model provider: run `qwen` and use `/auth`. |
| Codex: "not logged in" | The daemon inherits no session. Run `codex login`, then retry. |
| Codex answers about the page without opening it, or from a web search | Update Browsentic. Codex hides the browser tools until the model searches for them, and an older Browsentic left Codex's own web search switched on, which the model reached for first. |
| Mistral Vibe: a follow-up turn says *this agent run is no longer active* | Update Browsentic, then start a new conversation. An older one gave each turn its own folder, and Vibe keeps re-reading the first turn's, so a conversation begun before the update stays broken. |
| "does not understand the flags Browsentic uses" | The CLI is too old. Update it. |
| Antigravity answers but never touches the page | Its permission rule was removed. `browsentic agent` reports *needs setup* again. |
| Grok Build sits silent for minutes, then *xAI did not answer* | The Grok account is rate-limited — a free one usually is. Wait, or upgrade the account. |
| Cursor CLI: *Authentication required* | The daemon inherits no session. Run `cursor-agent login`, or set `CURSOR_API_KEY`, then retry. |
| Cursor CLI on Windows | Cursor's sandbox has no Windows backend, so only the deny rules apply there. The browser still works; the machine is less fenced off than on macOS or Linux. |
| `AGENT_UNSAFE`: *Grok Build offered this run …* | Grok offered tools Browsentic never asks for, so the run was stopped before the model saw them. Update Grok Build and Browsentic, and report it if it persists. |
| Qwen Code: *No auth type is selected* | Qwen has no provider configured, and its OAuth free tier has ended. Run `qwen` and use `/auth`, or export `OPENAI_API_KEY` with `OPENAI_BASE_URL`. |
| Qwen Code cannot find a key you have exported | Only `QWEN_*`, `DASHSCOPE_*`, `BAILIAN_*` and `OPENAI_*` reach a run; `ANTHROPIC_*` and `GEMINI_*` are sealed away. Point Qwen at one of the first four. |
| `AGENT_UNSAFE`: *Qwen Code registered …* or *loaded the MCP server …* | Qwen's own `init` line named a tool or a server Browsentic denied, so the run was stopped. Update Qwen Code and Browsentic, and report it if it persists. |

---

## See also

- [Configuration](configuration.md) — the rest of `config.json`
- [MCP clients](mcp-clients.md) — the other direction
- [internals/agent-runs.md](../internals/agent-runs.md) — how a run is actually spawned and streamed
