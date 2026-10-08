# Reference

Lookup tables for the page tools, the `browsentic` command and the error codes. For workflows, see
the [user guide](../guide/); for how Browsentic works, see [internals](../internals/).

| | |
| --- | --- |
| [Tools](tools.md) | All 52 page tools with their parameters, the three read-only resources, and the reserved actions that never become tools |
| [CLI](cli.md) | Every `browsentic` command and flag |
| [Errors](errors.md) | Every error code, where it comes from, and what to do about it |

The tool list is generated from [`src/lib/actions/registry.ts`](../../src/lib/actions/registry.ts).
To print the machine-readable copy:

```sh
yarn daemon:manifest
```
