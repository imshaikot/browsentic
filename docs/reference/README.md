# Reference

Lookup tables. Nothing here explains a workflow — see the [user guide](../guide/) for that, or
[internals](../internals/) for how it works.

| | |
| --- | --- |
| [Tools](tools.md) | All 41 MCP tools with their parameters, the three read-only resources, and the reserved actions that never become tools |
| [CLI](cli.md) | Every `browsentic-mcp` command |
| [Errors](errors.md) | Every error code, where it comes from, and what to do about it |

The tool list is generated from [`lib/actions/registry.ts`](../../lib/actions/registry.ts). The
machine-readable copy is always one command away:

```sh
yarn mcp:manifest
```
