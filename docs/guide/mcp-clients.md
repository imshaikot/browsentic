# Driving Browsentic from an MCP client

Pairing connects your *browser* to the daemon. Registering an MCP client lets **that client** drive
the same browser — Claude Code, Codex, Cursor, Zed, Gemini CLI, Claude Desktop, anything that
speaks MCP.

This direction is fully agent-agnostic. Nothing here depends on which CLI you picked in
[Choosing an agent](agents.md).

---

## Register

**Claude Code:**

```sh
claude mcp add browsentic -- browsentic-mcp
```

**Codex CLI** — TOML, in `~/.codex/config.toml`:

```toml
[mcp_servers.browsentic]
command = "browsentic-mcp"
```

**Anything else** — most clients take a JSON block of this shape:

```json
{
  "mcpServers": {
    "browsentic": { "command": "browsentic-mcp" }
  }
}
```

Check your client's own documentation for the exact file and key. The *command* is the part that
matters, and it is `browsentic-mcp` with no arguments everywhere.

**MCP servers are loaded at session start**, so restart the client session after registering.
Tools missing from a session you registered mid-flight is the single most common surprise here.

---

## What the client gets

- **41 page tools** — every one listed with its parameters in [reference/tools.md](../reference/tools.md)
- **`browsentic_status`** — whether the extension is connected, its version, the active tab, any
  running monitors, and a `hint` naming the fix when something is wrong. Call it first when a page
  tool fails.
- **Three read-only resources**, which return page context without spending a tool call:

| Resource | Use when |
| --- | --- |
| `browsentic://page/diagram` | You just need the page's shape — the cheapest useful view |
| `browsentic://page/current` | The full `page_getPageInfo` snapshot as JSON |
| `browsentic://page/text` | You only need the rendered prose |

The tool list is generated from the same registry the extension ships, so it cannot describe
something the browser cannot do. If the two halves *are* built from different registries, the daemon
adopts the browser's list and tells your client the tools changed.

---

## How this differs from the side panel

Both land on the same browser through the same daemon, so you can move between them mid-task. What
changes is everything around the tool call.

| | Side panel | MCP client |
| --- | --- | --- |
| Agent | The CLI you picked, spawned by the daemon | Whatever you registered |
| Consequential actions | Prompt you in the panel | **Refused** — see below |
| Host confinement | Scoped to the sites the run is about | Unconfined |
| Timeline | Every action, live | Actions appear tagged `external` |
| Skills and site notes | Routed and applied automatically | Not applied |
| Recordings, site mapping | Full access | Readable only (`page_listRecordings`, `page_readRecording`) |
| Voice input | Yes | No |
| Appears in `browsentic-mcp logs` | Yes | Yes |

### Consequential actions are denied, not waived

An MCP client has no approval channel — there is no panel to prompt in and nobody guaranteed to be
watching. So anything the [policy](approvals.md) would `confirm` resolves to **deny** for an external
caller, with a message telling the agent the action is only available from the side panel.

That covers form submission, file upload, answering a captcha, off-scope navigation, URLs carrying
a large payload, and moving to another tab. Reading, clicking, typing, scrolling, navigating within
scope, screenshots and monitors are all unaffected.

If you would rather your client's own permission system make that call, waive it:

```json
{ "guardrails": { "unattended": "allow" } }
```

Understand what that turns back on before you set it — [Approvals](approvals.md) lists every rule,
and [internals/guardrails.md](../internals/guardrails.md) explains why the default is the way round
it is.

### Page text arrives fenced

Every tool result carrying page-authored text is wrapped in a per-daemon random marker with a note
that its contents are data, never instructions. This happens where results are rendered, so external
clients get it too. It is not a proof against prompt injection — see [Limits](limits.md#prompt-injection-is-a-real-risk).

---

## Several clients at once

They share one daemon and one browser, so they interleave. Tool calls stay correctly correlated, but
page state can shift under either of them. The side panel can be running at the same time.

---

## See also

- [reference/tools.md](../reference/tools.md) — every tool and parameter
- [Approvals](approvals.md) — the full policy
- [Troubleshooting](troubleshooting.md) — including "tools missing from an MCP session"
