---
layout: layouts/doc.njk
pageKey: docs
title: "Contributing"
seoTitle: "Contributing — Browsentic internals"
description: "Build topology, the checks, and how to add a capability. Separate lockfiles. src/daemon/ imports src/lib/ through the @/ alias, which is how one registry…"
deck: "Build topology, the checks, and how to add a capability."
docsPath: "internals/contributing.md"
section: "internals"
sectionLabel: "Internals"
sectionOrder: 4
order: 9
isIndex: false
permalink: "/docs/internals/contributing/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/internals/contributing.md"
---
![One edit, two builds, two reloads — and the checks that gate a pull request](/docs/assets/contributing.png)

---

## Two Yarn projects

Separate lockfiles.

| | Extension | Daemon + MCP |
| --- | --- | --- |
| Root | `/` | `/mcp` |
| Bundler | WXT (Vite) | tsup |
| Output | `dist/chrome-mv3` | `src/daemon/dist` |
| Stack | React 19, Tailwind v4, shadcn/ui, zod | Node ≥20, `@modelcontextprotocol/sdk`, `ws`, zod |
| Build | `yarn build` | `yarn daemon:build` |

`src/daemon/` imports `src/lib/` through the `@/` alias, which is how [one registry](/docs/internals/registry/) ends up in two
bundles.

`node scripts/setup.mjs` (`yarn setup`) runs all four steps — both installs, both builds — using the
Yarn release vendored in the repository, so a fresh clone needs nothing on `PATH` but Node.

---

## Commands

```sh
yarn dev              # build, launch a throwaway Chrome profile, hot reload
yarn dev:firefox
yarn build            # production build
yarn zip              # store-ready archive
yarn compile          # type check the extension
yarn daemon:compile      # type check the daemon
yarn daemon:dev          # rebuild the daemon on change
yarn daemon:restart      # rebuild, then swap the running daemon for the fresh build
yarn daemon:manifest     # print the tool manifest, no browser needed
yarn check:intent     # route a fixture table of utterances through the local grammar
yarn check:security
yarn check            # both type checks plus both fixture suites
```

**Run `yarn check` before opening a pull request.** If you touched the action registry, also run
`yarn daemon:manifest` and keep [reference/tools.md](/docs/reference/tools/) in step with what it prints.

### The daemon keeps the old build in memory

The daemon has no start command: the first CLI or MCP client that needs it spawns it, and it lives
until `browsentic stop` or 30 idle minutes with nothing attached.

The flip side is that **a rebuild alone changes nothing while a daemon is running**. That is what
`yarn daemon:restart` is for: it rebuilds, stops the stale daemon and brings up the fresh build. The
extension cannot spawn the daemon; it only reconnects to one.

---

## Adding a capability

Write `src/lib/actions/page/<name>.ts` and add it to the array in `src/lib/actions/registry.ts`. That single
edit publishes it as an MCP tool, because the daemon bundles the same registry.

Four conventions are load-bearing at runtime rather than at compile time:

1. **Touch `document`/`window` only inside `execute()`** — the module is also imported by the daemon,
   where there is no DOM.
2. **No underscores in action names** — they break the [tool-name round trip](/docs/internals/registry/#names).
3. **`.describe()` every input field** — the text becomes the tool's JSON Schema documentation, and
   it is all the model gets.
4. **Validate with `ActionError` inside `execute()`**, not zod `.refine()`/`.transform()` — those do
   not survive JSON Schema conversion.

Then rebuild **both** halves and reload the extension at `chrome://extensions`. Chrome does not
auto-reload unpacked extensions, and a stale service worker is the usual cause of a drifted manifest.

### If the capability is consequential

Add a rule to [`src/daemon/guardrails/policy.ts`](https://github.com/imshaikot/browsentic/blob/main/src/daemon/guardrails/policy.ts) rather than a
check inside the action — the policy is meant to be printable and diffable in one place. If it needs
a new predicate, add it to `CONDITIONS`; the vocabulary is closed on purpose.

### If it should be reachable from the side panel without an agent

Add a rule to [`src/lib/intent/grammar.ts`](https://github.com/imshaikot/browsentic/blob/main/src/lib/intent/grammar.ts) and a fixture to the
`yarn check:intent` table. Bias toward escalating — see
[the intent funnel](/docs/internals/agent-runs/#the-intent-funnel).

---

## Adding an agent runner

One file in [`src/daemon/agent/runners/`](https://github.com/imshaikot/browsentic/tree/main/src/daemon/agent/runners/) plus one line in
`runners/index.ts`. The shared driver does the spawning, abort wiring and line reading; your runner
decides what to say and how to read the answer back.

You must also add a `CONTAINMENT` entry in
[`src/daemon/guardrails/spawn.ts`](https://github.com/imshaikot/browsentic/blob/main/src/daemon/guardrails/spawn.ts) declaring which containment mode
that CLI supports and what its plan must carry. `vetPlan()` refuses to spawn a runner whose plan does
not match — that is the point, and it is asserted in tests without spawning anything.

---

## See also

- [The action registry](/docs/internals/registry/) — why the manifest cannot drift silently
- [Guardrails](/docs/internals/guardrails/) — where enforcement lives
- [reference/tools.md](/docs/reference/tools/) — the page to keep in step
