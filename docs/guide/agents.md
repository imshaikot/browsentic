# Choosing an agent

The side panel runs on an agent CLI you already have logged in. Eight are supported — Mistral Vibe,
Grok Build, Cursor CLI, Qwen Code and OpenCode in beta — and switching is a click.

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

### Where the models come from

Where a CLI can say which models your account has, the select offers those:

| Agent | Read from |
| --- | --- |
| Codex | the model cache Codex keeps itself, `~/.codex/models_cache.json` |
| Antigravity | `agy models` |
| Grok Build | `grok models` |
| Cursor CLI | `cursor-agent models` — over 200, so the select becomes a filter, with Browsentic's picks first |

The other four have no such command, so the select offers a short list Browsentic ships. For Claude
Code those are its aliases — `fable`, `opus`, `sonnet`, `haiku` — which it resolves to the newest
model of each family.

The Bridge reads a list in the background and never holds the popup up for one. A list it has read
is kept for six hours, and read again at once when the CLI is updated; *Recheck* reads it again now.
When a read fails — the CLI is signed out, times out, or prints something Browsentic cannot parse —
the last list that read cleanly stays, or the shipped one when there is none, and the line under the
select says why. A model you pinned yourself is never changed: if the CLI stops listing it, it stays
selected, marked *not listed*.

The same thing from a terminal:

```sh
browsentic agent                  # what is installed, and what runs the side panel
browsentic agent codex            # switch
browsentic agent fix antigravity
browsentic agent models cursor    # the models the select offers, and where they came from
browsentic agent models cursor --refresh
```

Switching takes effect on the next instruction. It also drops the conversation being held open:
agents cannot resume each other's sessions, so the next instruction starts a fresh one.

---

## The eight

| | Claude Code | Codex | Antigravity | Mistral Vibe (beta) | Grok Build (beta) | Cursor CLI (beta) | Qwen Code (beta) | OpenCode (beta) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vendor | Anthropic | OpenAI | Google | Mistral AI | xAI | Anysphere | Alibaba | Anomaly |
| Binary | `claude` | `codex` | `agy` | `vibe` | `grok` | `cursor-agent` | `qwen` | `opencode` |
| Install | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` | [antigravity.google/docs/cli/install](https://antigravity.google/docs/cli/install) | `uv tool install mistral-vibe` | `curl -fsSL https://x.ai/cli/install.sh \| bash` | `curl https://cursor.com/install -fsS \| bash` | `npm i -g @qwen-code/qwen-code` | `npm i -g opencode-ai` |
| Default model | `sonnet`, the newest Sonnet | the CLI's own | the CLI's own | the CLI's own | the CLI's own | the CLI's own | the CLI's own | the CLI's own |
| Effort names | `low`…`max` | `low`…`xhigh` | `low`…`high` | none — set `thinking` in Vibe's own config | `low`…`xhigh` | none — put it in the model id, e.g. `claude-opus-4-8[effort=high]` | none — the model id is the only lever | a variant the model defines, e.g. `high` or `max` |
| Kept off your machine by | a per-run tool allowlist plus an explicit deny list | its shell and image viewer switched off, no MCP server but the browser's, and a read-only sandbox (`sandbox_mode="read-only"`) | its own permission rules | a per-run tool allowlist — its shell and file tools are never loaded | a per-run tool list, approvals that refuse anything not granted up front, and a kernel sandbox that keeps its writes in its own folder | per-run deny rules, where a deny beats every allow; a kernel sandbox is asked for too but not depended on | `--safe-mode`, which drops every setting of your own, plus deny rules for the shell, the disk and the tools that reach either | a per-run agent whose rules deny every tool not named for it, so the model is never offered the shell, the disk or another server's tools |

All eight get the same system prompt, the same browser tools — over a `browsentic` MCP server pointed
back at the Bridge, or for Codex handed to it directly — and the same [approval gate](approvals.md).
What differs is how well each one can be fenced off from the rest of your machine — see
[internals/guardrails.md § Spawn containment](../internals/guardrails.md#spawn-containment) for
exactly what each flag buys.

**Keep whichever you use reasonably current.** Browsentic passes flags that contain the run. A build
too old to understand them fails the run with an explicit "update it" message rather than running
uncontained.

### Follow-up messages, on Claude Code, Codex and Cursor

All three keep the system prompt a conversation began with. Claude Code records it on the first
request and sends that record on every resume (its `--system-prompt-snapshot`, on by default), Codex
does the same with its developer instructions, and Cursor answers a resumed turn from the `AGENTS.md`
the conversation started with. A later message that changes what the agent should know —
an element picked with A-Eye, a skill attached from the picker, a different skill for the job, notes
for the site you have moved to — would otherwise never reach it.

So Browsentic carries what changed in the message itself: a short *instructions for this message*
section ahead of your words, holding only the parts that differ from what the conversation already
has, and naming any that no longer apply. A message that changes nothing carries nothing extra. After
the Bridge restarts it cannot know what a conversation holds, so the first follow-up restates the
whole prompt once. The agent's prompt cache is untouched either way, because nothing that came before
changes.

### Codex gets the browser tools as its own

Codex runs through its **app-server** — the interface its own editor extensions use — held open for
the length of a turn. Browsentic hands it the browser tools directly, so they are in the model's
list from the first request, rather than as an MCP server whose tools Codex would defer until the
model searched for them. Its replies stream in as they are written, and the context card shows how
full its window is. Each tool call it makes comes back to the Bridge and goes through the same gate,
approvals and timeline as a Claude Code run's.

The app-server interface is marked experimental. If a Codex build refuses it, the same turn runs
through `codex exec` instead and later turns go straight there until the Bridge restarts; the two
resume each other's conversations. `"transport": "exec"` under `agents.codex` in `config.json`
chooses exec outright.

Your `config.toml` still applies on the app-server — your model, provider and profile among it —
except its MCP servers: Browsentic asks Codex which there are and switches each one off for the
thread, and a run in which one starts anyway is stopped (`AGENT_UNSAFE`). Through exec, Browsentic
starts Codex with `--ignore-user-config` instead, because a `-c` flag only merges into that file:
`mcp_servers={}` clears nothing, and settings on a `browsentic` entry of your own would land on the
run's. Your sign-in comes from `~/.codex` either way, and through exec the `model` and
`model_reasoning_effort` at the top of your `config.toml` still apply when nothing is picked in the
popup.

**Through exec, Codex keeps the tools out of sight.** They are deferred behind its `tool_search`,
and on a code-mode model (`gpt-5.6-terra` and the like) they exist only inside its `exec` sandbox.
Left to itself, a model answers a question about the page from the tools it *can* see — its own
memory, or a web search — so an exec run is given a section of prompt saying where its browser
tools are and how to load them. Its replies arrive whole, and it reports tokens only for a whole
turn, added up over every request in it and every turn before, so the context card shows no count
for it rather than a wrong one.

**Either way it has no shell and no image viewer.** Both read your disk, and a browsing run has the
page for that. Codex still offers its patch tool — nothing switches it off — and its read-only
sandbox refuses every write. If a run ever reports a shell command or a changed file anyway,
Browsentic stops it. Web search is switched off unless the run is [mapping a site](features/site-maps.md),
and so are sub-agents, goal memory, connector apps, plugins, image generation, Codex's own browser
and computer use, and the list of your Codex skills. A code-mode model can still spawn sub-agents —
nothing in Codex 0.155 turns that off — but they share the run's browser tools, so each of their
actions goes through the same approval gate and shows on the timeline.

A code-mode model calls the tools from inside its `exec` scripts. There a result holding a
screenshot comes back as one string, the picture's `data:` URL on its first line, and the prompt
tells the model to pass that line to `image()`. **Codex cuts a tool result at 10,000 tokens** by
default; Browsentic raises that to 25,000, the ceiling Claude Code puts on the same result, and the
prompt asks a code-mode script to raise its own and to read in smaller pieces.

The file analyst reading a text file keeps the shell, read-only; a picture is attached to its
message instead of opened. One-shots always run through exec.

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

Browsentic's Cursor runner was measured against `cursor-agent 2026.09.18-9a7762b` through its own
plan: the browser tools reaching the model, a picture, a long result, a call that runs past a
minute, a resumed turn, its containment, and a one-shot reading a PNG and a PDF.

- **Sign in first.** Run `cursor-agent login`, or set `CURSOR_API_KEY`. Until then a run fails with
  *Authentication required*.
- **Each turn approves the run's own MCP server.** Cursor starts a project's MCP server only once it
  is approved, and an approval covers that exact configuration, which names the run. So before each
  turn Browsentic runs `cursor-agent mcp enable browsentic` in the run's folder — that one server,
  never `--approve-mcps`, which would approve every server you have. Each adds a line to that
  folder's `mcp-approvals.json` under `~/.cursor/projects`.
- **The model looks a tool up before its first call.** Cursor shows the model a tool's schema only
  when it asks for it, so the first browser action of a conversation takes one step more than on
  Claude Code; the run's prompt has it look up everything the job needs at once.
- **Cursor gives up on a tool call after 60 seconds.** An approval you have not answered by then
  stays on screen: the agent is told you have not decided yet and asks again, under the same card,
  until you do. Anything else it does takes the request down, and an answer after that does
  nothing. Waits inside a call — a monitor, a pick, a captcha, a download — are cut to fit, and
  picked up again with the next call.
- **Text over 40,000 bytes never reaches the model.** Cursor would put a longer result in a file the
  run is not allowed to read, so Browsentic refuses it instead (`RESULT_TOO_LARGE`) and the model
  asks for the page a piece at a time. A long text read is split into pieces that fit.
- **No context count.** Cursor reports tokens added up over every request in a turn, so the context
  card shows none rather than a wrong one.
- **Your own Cursor MCP servers, and every plugin's, are denied.** A project config does not replace
  the global `~/.cursor/mcp.json`, so every server you configured for Cursor itself would otherwise
  load beside Browsentic's — including your own `browsentic` entry, which reaches the browser
  without a run's approval gate. Browsentic reads that file and denies each of them for the run,
  and denies every plugin's server, `plugin-*`, as one. It never writes to that file. If a server it
  denied answers a call anyway, the run is stopped.
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

### OpenCode is in beta

Browsentic's OpenCode runner was checked against `opencode` 1.18.32 with a stand-in for the model
provider: every flag and setting it passes, the containment under a user config written to break
it, the browser tools reaching a run, a follow-up turn resuming, and each error OpenCode reports.
What has not been through it yet is a real model driving a real page, because OpenCode Zen's free
models refuse a contained run and no paid provider was signed in where it was built. Expect rough
edges, and please report them.

- **Sign in to a provider first.** Run `opencode auth login`. Zen's free models answer only
  requests that carry OpenCode's own built-in tools, and a Browsentic run carries the browser's
  alone, so they refuse it with *free tier can only be used from within OpenCode*. Until OpenCode
  has a login, or a provider in its config such as a local model, the popup shows *needs setup*.
- **Models are `provider/model`**, spelled as `opencode models` lists them.
- **A key in the environment does not reach a run.** Only `OPENCODE_*` does; `ANTHROPIC_API_KEY`
  and the like are sealed away. `opencode auth login` keeps the key in OpenCode's own file instead,
  which a run reads as usual.
- **Your OpenCode settings are read, and cannot widen a run.** Your providers, models and
  `~/.config/opencode/AGENTS.md` apply. The run is an agent of Browsentic's own whose rules deny
  every tool not named for it, so your permission rules, custom tools and the MCP servers you set up
  in OpenCode itself are hidden from the model — those servers still start. External plugins and
  project config are off for the run.
- **Sharing is off.** A `"share": "auto"` of your own would publish every browsing session to a
  public link, so a run switches sharing off.
- **Its sessions are kept apart from yours.** Runs and one-shots go into a session store under
  `~/.browsentic`, not into `opencode session list`.
- **Replies arrive a part at a time.** OpenCode's stream carries each finished part rather than
  tokens, as Vibe's does.
- **A tool result is cut at 100 KB** rather than OpenCode's own 50 KB, which a whole-page snapshot
  can pass. Past that, the prompt asks for smaller reads, because the saved copy OpenCode points to
  cannot be opened in a run.
- **Effort is a variant.** `agents.opencode.effort` is passed as `--variant`, whose names each model
  defines; one a model lacks is ignored.
- **The run is stopped if a local tool ran.** OpenCode reports every tool call, and one that ran
  outside the browser ends the run with `AGENT_UNSAFE`.

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
    "qwen": { "bin": "qwen", "model": "qwen3-coder-plus" },
    "opencode": { "bin": "opencode", "model": "anthropic/claude-sonnet-5" }
  }
}
```

| Key | Default | Effect |
| --- | --- | --- |
| `agent` | `claude` | Which CLI the side panel runs on. The agent picker writes this. |
| `agents.<name>.bin` | the CLI's own command name | Absolute path to the binary. Set this when the Bridge's `PATH` differs from your shell's — the usual cause of `AGENT_MISSING`. On Windows it may name the `.cmd` npm installed, or the `.exe` itself. |
| `agents.<name>.model` | `sonnet` for Claude, otherwise the CLI's own default | Passed as `--model`. The picker's model select writes this. A value that starts with a dash or holds a space is ignored, so a typo cannot pass the CLI a flag. |
| `agents.<name>.effort` | unset | Passed as that CLI's reasoning-effort flag. A value the CLI does not accept is dropped rather than failing the run. |

Changes apply to the next run — the config is re-read each time, no daemon restart needed.

The pre-0.2 top-level `claudeBin`, `model` and `effort` keys are still honoured, and read as the
Claude runner's settings.

---

## Common problems

| Symptom | Fix |
| --- | --- |
| `AGENT_MISSING` | The Bridge's `PATH` differs from your shell's. Set `agents.<name>.bin` to an absolute path. |
| `AGENT_NEEDS_PERMISSION` | Antigravity has no rule for Browsentic's tools: press the button, or `browsentic agent fix antigravity`. Grok Build is not signed in: run `grok login`. Qwen Code has no model provider: run `qwen` and use `/auth`. OpenCode is signed in to no provider: run `opencode auth login`. |
| Codex: "not logged in" | The Bridge inherits no session. Run `codex login`, then retry. |
| Codex answers about the page without opening it, or from a web search | Update Browsentic. Codex hides the browser tools until the model searches for them, and an older Browsentic left Codex's own web search switched on, which the model reached for first. |
| Mistral Vibe: a follow-up turn says *this agent run is no longer active* | Update Browsentic, then start a new conversation. An older one gave each turn its own folder, and Vibe keeps re-reading the first turn's, so a conversation begun before the update stays broken. |
| "does not understand the flags Browsentic uses" | The CLI is too old. Update it. |
| Antigravity answers but never touches the page | Its permission rule was removed. `browsentic agent` reports *needs setup* again. |
| Antigravity: a follow-up turn searches the web, or ends with no answer, instead of reading the page | Update Browsentic, then start a new conversation. An older one gave each turn its own folder, and Antigravity keeps re-reading the first turn's, so every browser call in a later turn was refused as *no longer active*. A conversation begun before the update stays broken. |
| Grok Build sits silent for minutes, then *xAI did not answer* | The Grok account is rate-limited — a free one usually is. Wait, or upgrade the account. |
| Cursor CLI: *Authentication required* | The Bridge inherits no session. Run `cursor-agent login`, or set `CURSOR_API_KEY`, then retry. |
| Cursor CLI on Windows | Cursor's sandbox has no Windows backend, so only the deny rules apply there. The browser still works; the machine is less fenced off than on macOS or Linux. |
| Windows: `AGENT_UNUSABLE`, *a batch file Browsentic cannot see through* | The agent's command is a batch file that is not an npm or pnpm shim. Set `agents.<name>.bin` to the `.exe` it runs. |
| Windows: *This turn is too long for Windows to start* | Codex's `exec` fallback, Qwen Code and Grok Build pass the prompt as an argument, which Windows caps at 32,767 characters. Start a new conversation, or leave out long site notes and attachments. See [Limits](limits.md#windows-is-experimental). |
| `AGENT_UNSAFE`: *Grok Build offered this run …* | Grok offered tools Browsentic never asks for, so the run was stopped before the model saw them. Update Grok Build and Browsentic, and report it if it persists. |
| Qwen Code: *No auth type is selected* | Qwen has no provider configured, and its OAuth free tier has ended. Run `qwen` and use `/auth`, or export `OPENAI_API_KEY` with `OPENAI_BASE_URL`. |
| Qwen Code cannot find a key you have exported | Only `QWEN_*`, `DASHSCOPE_*`, `BAILIAN_*` and `OPENAI_*` reach a run; `ANTHROPIC_*` and `GEMINI_*` are sealed away. Point Qwen at one of the first four. |
| `AGENT_UNSAFE`: *Qwen Code registered …* or *loaded the MCP server …* | Qwen's own `init` line named a tool or a server Browsentic denied, so the run was stopped. Update Qwen Code and Browsentic, and report it if it persists. |
| OpenCode: *free models refuse a run whose tools Browsentic has narrowed to the browser* | Zen's free tier serves only requests carrying OpenCode's own tools. Run `opencode auth login`, then pick that provider's model in the popup. |
| OpenCode: *could not start this turn* | Usually a model OpenCode does not know. Pick one as `opencode models` lists it, `provider/model`. |
| The model select says *built-in list*, with a reason | Browsentic could not read that CLI's own list, usually because it is signed out. Sign it in, then press *Recheck*. The shipped list works meanwhile. |
| A model shows *not listed* | You pinned it, and the CLI no longer lists it. It is still passed to the CLI; pick a listed one if runs start failing. |
| OpenCode cannot find a key you have exported | Only `OPENCODE_*` reaches a run. Run `opencode auth login` instead, which keeps the key in OpenCode's own file. |
| `AGENT_UNSAFE`: *OpenCode ran its own … tool* | A tool outside the browser ran despite the run's rules, so the run was stopped. Update OpenCode and Browsentic, and report it. |

---

## See also

- [Configuration](configuration.md) — the rest of `config.json`
- [MCP clients](mcp-clients.md) — the other direction
- [internals/agent-runs.md](../internals/agent-runs.md) — how a run is actually spawned and streamed
