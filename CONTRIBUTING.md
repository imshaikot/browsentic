# Contributing to Browsentic

Found a bug, or have an idea for a capability? Both are welcome. This page is the front door:
what kinds of contribution land well, the one gate every pull request goes through, and where
the deeper guides live.

## Ways in

| You have | Do this |
| --- | --- |
| A bug | [Open a bug report](https://github.com/imshaikot/browsentic/issues/new?template=bug_report.yml) with `browsentic status` output |
| A capability idea | [Open a proposal](https://github.com/imshaikot/browsentic/issues/new?template=capability.yml) before writing code |
| A security problem | **Not an issue.** [Report it privately](SECURITY.md) — this tool holds live browser sessions |
| A docs fix | Edit under `docs/` and open a PR straight away — no issue needed |
| A small code fix | A PR straight away is fine too |

Proposals before code, for anything that adds surface: a capability ships as an MCP tool the
moment it lands in the registry, so its name, shape and guardrails are API decisions worth two
paragraphs of discussion before they are a diff.

## Setup

One command builds everything — both projects, both bundles — with nothing on your `PATH` but
Node 20+:

```sh
yarn setup
```

Then `yarn dev` launches a throwaway Chrome profile with hot reload. The full build topology,
the daemon's lifecycle, and every command live in the
[internals contributing guide](docs/internals/contributing.md).

## The gate

```sh
yarn check
```

That is both type checks plus the intent and security fixture suites — the same command CI runs
on your pull request. Green locally means green in CI.

If you touched the action registry, also run `yarn daemon:manifest` and keep
[docs/reference/tools.md](docs/reference/tools.md) in step with what it prints. The manifest is
generated from the registry, so the docs are the only place drift can hide.

## Adding a capability

The short version: one action module in `src/lib/actions/page/`, one line in
[the registry](src/lib/actions/registry.ts), and the daemon publishes it as an MCP tool — the
extension and the MCP server build from the same registry, so a tool can never describe
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
  the failure makes no sense — the fixtures have opinions.

## Conduct

Be the person you would want reviewing your first PR. The specifics are in the
[code of conduct](CODE_OF_CONDUCT.md).

## License

Browsentic is [MIT licensed](LICENSE). Contributions are accepted under the same terms:
inbound = outbound, no CLA.
