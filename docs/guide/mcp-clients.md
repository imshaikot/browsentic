# Driving Browsentic from an MCP client

An optional second way in: register Browsentic with an MCP client (Claude Code, Codex, Cursor, Zed,
Gemini CLI, Claude Desktop or anything else that speaks MCP) and that client drives the same paired
browser as the side panel. The side panel needs none of this.

Nothing here depends on which agent CLI the side panel runs on ([Choosing an agent](agents.md)).

---

## Register

**Claude Code:**

```sh
claude mcp add browsentic -- browsentic mcp
```

**Codex CLI**, in `~/.codex/config.toml`:

```toml
[mcp_servers.browsentic]
command = "browsentic"
args = ["mcp"]
```

**Other clients**: most take a JSON block of this shape:

```json
{
  "mcpServers": {
    "browsentic": { "command": "browsentic", "args": ["mcp"] }
  }
}
```

Your client's documentation gives the exact file and key. The command is the same everywhere:
`browsentic` with the single argument `mcp`.

**Clients load MCP servers when a session starts**, so restart the client session after
registering. A session that was already open has no Browsentic tools; this is the most common
surprise here.

---

## What the client gets

- **All 52 page tools**, each listed with its parameters in [reference/tools.md](../reference/tools.md)
- **`browsentic_status`**: whether the extension is connected, its version, the active tab, any
  running monitors, and a `hint` naming the fix when something is wrong. Call it first when a page
  tool fails.
- **Three read-only resources**, which return page context without spending a tool call:

| Resource | Use when |
| --- | --- |
| `browsentic://page/diagram` | You only need the page's shape, the cheapest useful view |
| `browsentic://page/current` | The full `page_getPageInfo` snapshot as JSON |
| `browsentic://page/text` | You only need the rendered prose |

The tool list is generated from the same registry the extension ships, so it cannot describe
something the browser cannot do. If the two halves *are* built from different registries, the Bridge
adopts the browser's list and tells your client the tools changed.

---

## How this differs from the side panel

Both reach the same browser through the same Bridge, so you can switch between them mid-task. What
differs is everything around the tool call:

| | Side panel | MCP client |
| --- | --- | --- |
| Agent | The CLI you picked, spawned by the Bridge | Whatever you registered |
| Consequential actions | Prompt you in the panel | **Refused** (see below) |
| Host confinement | Scoped to the sites the run is about | Unconfined |
| Timeline | Every action, live | Actions appear tagged `external` |
| Skills and site notes | Routed and applied automatically | Not applied |
| Recordings, site mapping | Full access | Readable only (`page_listRecordings`, `page_readRecording`) |
| Voice input | Yes | No |
| Appears in `browsentic logs` | Yes | Yes |

### Actions that need approval are refused

An MCP client has no approval channel: there is no panel to prompt in and no guarantee anyone is
watching. So anything the [policy](approvals.md) would `confirm` resolves to **deny** for an external
caller, with a message telling the agent the action is only available from the side panel.

That covers form submission, file upload, answering a captcha, off-scope navigation, URLs carrying
a large payload, and moving to another tab. Reading, clicking, typing, scrolling, navigating within
scope, screenshots and monitors are all unaffected.

If you would rather your client's own permission system make that call, waive it:

```json
{ "guardrails": { "unattended": "allow" } }
```

Read what that turns back on before you set it: [Approvals](approvals.md) lists every rule, and
[internals/guardrails.md](../internals/guardrails.md) explains why the default is the way round it
is.

### Page text arrives fenced

Every tool result carrying page-authored text is wrapped in a per-daemon random marker with a note
that its contents are data, never instructions. This happens where results are rendered, so external
clients get it too. It is not a proof against prompt injection; see [Limits](limits.md#prompt-injection-is-a-real-risk).

---

## Several clients at once

Clients share one Bridge and, unless several browsers are connected, one browser, so their calls
interleave. Each call still gets its own result, but page state can shift under either client. The
side panel can be running at the same time.

---

## See also

- [reference/tools.md](../reference/tools.md): every tool and parameter
- [Approvals](approvals.md): the full policy
- [Troubleshooting](troubleshooting.md): including "tools missing from an MCP session"
