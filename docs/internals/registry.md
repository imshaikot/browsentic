# The action registry

One definition, compiled into two bundles.

---

## One array, two consumers

There are **37 page capabilities**. They are defined once, in
[`lib/actions/registry.ts`](../../lib/actions/registry.ts), and that array is compiled into **both**
the extension and the daemon.

Each action is a small module — a name, a description, a zod input schema, and an `execute()`:

```ts
export const clickElement = defineAction({
  name: 'page.clickElement',
  description: '…',
  input: z.object({ target: targetSchema.describe('…') }),
  execute({ target }) { /* runs in the page */ },
});
```

`describeActions()` turns that array into tool descriptors by converting each zod schema to JSON
Schema. The daemon serves those descriptors to MCP clients, so **an MCP tool cannot describe a
capability the browser does not have** — they are generated from the same source.

---

## Names

Action names are dotted (`page.getPageInfo`); MCP tool names are underscored
(`page_getPageInfo`). The mapping is mechanical.

`assertToolNamesRoundTrip()` runs on every `tools/list` to prove that every name survives the round
trip and that no two actions collide. That check is why **action names must not contain
underscores** — `page.get_info` would come back as `page.get.info`.

---

## Drift detection

The extension hashes its bundled manifest and sends the hash in `hello`. If it differs from the
daemon's, the daemon:

1. flags `manifestInSync: false` — visible in `browsentic-mcp status` and `browsentic_status`;
2. asks the extension for its actual descriptor list over a `describe` frame and **adopts it** — the
   browser is the authority on what the browser can do;
3. broadcasts `manifest-changed` to control clients, which makes each MCP server emit
   `notifications/tools/list_changed`.

So a half-rebuilt install degrades into "the tools the browser really has", **loudly**, rather than
into tool calls that fail at the far end.

The fix is always to rebuild both halves — see [guide/maintenance.md](../guide/maintenance.md#updating).

---

## Reserved actions

Four names under the `browsentic.` prefix are not page actions:

| Action | Who calls it |
| --- | --- |
| `browsentic.saveSiteMap` | The agent, at the end of a mapping run |
| `browsentic.startRecording` | The intent grammar, on the user's own words |
| `browsentic.stopRecording` | The intent grammar |
| `browsentic.readSitemap` | The daemon's agent runner |

The daemon's `invoke()` refuses anything starting with that prefix, so they are unreachable from an
ordinary MCP client. `browsentic_saveSiteMap` is published as a tool **only** to the MCP server
spawned inside an agent run.

`browsentic_status` is likewise not in the registry — the MCP server answers it directly by
combining daemon state with a one-element `page.getPageInfo` and the current monitor list.

---

## Verifying

```sh
yarn mcp:manifest
```

Builds the MCP server and prints every tool with its full JSON Schema. No browser needed. This is
the source of truth that [reference/tools.md](../reference/tools.md) is kept in step with.

---

## Next

**[Request path →](request-path.md)** — a tool call reaching the page.

Adding one: [Contributing § Adding a capability](contributing.md#adding-a-capability).
