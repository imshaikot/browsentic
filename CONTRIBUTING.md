# Contributing to Browsentic

Bug reports, capability ideas and pull requests are welcome. This page covers where each kind of
contribution goes, the one check every pull request must pass, and where the deeper guides live.

## Ways in

| You have | Do this |
| --- | --- |
| A bug | [Open a bug report](https://github.com/imshaikot/browsentic/issues/new?template=bug_report.yml) with `browsentic status` output |
| A capability idea | [Open a proposal](https://github.com/imshaikot/browsentic/issues/new?template=capability.yml) before writing code |
| A security problem | **Not an issue.** [Report it privately](SECURITY.md): Browsentic holds live browser sessions |
| A docs fix | Edit under `docs/` and open a PR straight away; no issue needed |
| A small code fix | A PR straight away is fine too |

Propose before you code anything that adds surface. A capability becomes a page tool, for the
side panel's agent and for MCP clients alike, the moment it lands in the registry, so its name,
shape and guardrails are API decisions worth two paragraphs of discussion before they become a diff.

## Setup

One command builds everything (both projects, both bundles) with nothing on your `PATH` but
Node 20+:

```sh
yarn setup
```

Then `yarn dev` launches a throwaway Chrome profile with hot reload. The full build topology,
the daemon's lifecycle, and every command live in the
[internals contributing guide](docs/internals/contributing.md).

## The required check

```sh
yarn check
```

It runs both type checks and the test suite with its coverage floors. CI runs the same command on
your pull request, so green locally means green in CI.

If you touched the action registry, also run `yarn daemon:manifest` and keep
[docs/reference/tools.md](docs/reference/tools.md) in step with what it prints. The manifest is
generated from the registry, so the docs are the only place drift can hide.

## Tests

A test sits next to the module it tests, as `<module>.test.ts`, and runs with
[Vitest](https://vitest.dev):

```sh
yarn test                          # everything
yarn test src/daemon/guardrails    # one directory or file
yarn coverage                      # everything, then coverage by area against its floors
```

Where a test lives decides what it runs in:

| Where | Runs in |
| --- | --- |
| `src/lib/**` | Node, with WXT's fake `browser` |
| `src/lib/actions/page/**` | happy-dom |
| `src/daemon/**` | Node, with `HOME` and the daemon's state in a throwaway directory and ports the OS picks |
| `src/daemon/test/**` | The same sandbox, for tests that start a real daemon |

Never put a test under `src/extension/entrypoints/`, because WXT builds every file there as an
entrypoint. The floors in [vitest.coverage.ts](vitest.coverage.ts) only ever go up: raise one when
your tests lift an area, and never lower one to get a build through.

## Adding a capability

The short version: one action module in `src/lib/actions/page/`, one line in
[the registry](src/lib/actions/registry.ts), and the daemon publishes it as a page tool over MCP.
The extension and the MCP server build from the same registry, so a tool can never describe
something the browser cannot do. The long version, including the four conventions that are
load-bearing at runtime, is in the
[internals guide](docs/internals/contributing.md#adding-a-capability).

Think about the guardrail while you are there: anything that commits something, sends data
somewhere, or acts on another site's security control should carry a rule in the
[policy](docs/guide/approvals.md), not a scattered check.

## Pull requests

- **One concern per PR.** A fix and a refactor are two PRs.
- **Conventional commits**, subject line first: `feat(actions): …`, `fix(daemon): …`,
  `docs: …`. Look at `git log --oneline` and match it.
- **Docs travel with the change.** A new capability without its `docs/` page is half a PR.
- CI runs `yarn check` and both builds on every PR. A red check is yours to fix, but ask if
  the failure makes no sense.

## Conduct

Be the person you would want reviewing your first PR. The specifics are in the
[code of conduct](CODE_OF_CONDUCT.md).

## License

Browsentic is licensed under the [Apache License 2.0](LICENSE). Contributions are accepted under the same terms:
inbound = outbound, no CLA.
