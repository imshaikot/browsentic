# Declarative refactor plan

Target: `lib/`, `components/`, `entrypoints/`, `mcp/src/` — 108 files, ~12.7k lines.

## Verdict first

The action layer (`lib/actions/`) and the intent funnel (`lib/intent/`) are already
declarative — a registry of frozen descriptors, a rules table scored by a pure router.
They are the model. Almost nothing else in the project follows them.

The imperative weight is concentrated in six places, and it is mostly **duplication**,
not style: the same pattern hand-written three or four times, each copy free to drift.
That is the refactor's real payoff. "Fewer `for` loops" is not.

Counted, in the current tree:

| Pattern | Copies | Where |
| --- | --- | --- |
| Pending-request + timeout + promise map | 4 | [socket.ts:63-176](lib/bridge/socket.ts#L63-L176) |
| Frame handler with `.then/.catch` envelope | 7 | [daemon.ts:197-246](mcp/src/daemon.ts#L197-L246) |
| `storage.local` index + body store | 4 | `file-store`, `session-store`, `skill-store`, `recording-store` |
| Byte-budgeted prompt section builder | 2 | [service.ts:356-419](mcp/src/agent/service.ts#L356-L419) |
| Scrub-and-cap-every-leaf validator | 2 | `lib/skills/site-map.ts`, `lib/recordings/workflow.ts` |
| `(input as { x?: unknown })` re-parse of a schema'd input | ~36 | 17 files |

Module-level mutable state: 12 `let`s across three files (`socket.ts`, `run-port.ts`,
`recorder.ts`). Those three *are* state machines; they are just written as globals.

## What this plan will not touch

Deciding this up front matters more than the rest of the plan, because a blanket
"make it declarative" sweep would damage each of these.

- **`renderInline` in [markdown.tsx:354-411](components/markdown.tsx#L354-L411).** A hand-tuned
  single-pass scanner with shared sticky regexes, a `lastIndex`-before-recursion rule, and a
  bounded look-ahead that exists because unbounded backtracking measured at 29s of blocked
  main thread. It re-runs per streamed token. Split the *file*; do not restructure the loop.
- **`send()` / `readCapped()` in [sitemap.ts:188-268](mcp/src/agent/sitemap.ts#L188-L268).**
  The running byte counter and destroy-on-overflow *are* the control against a 4 MB gzip bomb.
  A `.reduce()` over chunks would remove the early exit. Extract the pure parsers around it.
- **Capture-phase listeners in [capture.ts:220-234](lib/recordings/capture.ts#L220-L234).**
  They must be imperative registrations in the page, and the mutable `pendingFill` /
  `lastClickAt` state is what makes the recorder semantic rather than a DOM replay.
- **`spawnClaude` argv assembly in [runner.ts:31-190](mcp/src/agent/runner.ts#L31-L190).**
  The `--tools ''` allowlist is a security boundary. It can become a typed builder; the
  flag list must stay a literal that reads top-to-bottom in review.
- **Action names, `.describe()` strings, and registry order.** `describeActions()` is hashed
  (`hashManifest`) and compared at `hello`. Any incidental change to those forces a lockstep
  rebuild of extension + daemon. Refactor *around* the registry, never through it.

Three modules also have hard import constraints that survive the refactor:
`lib/skills/format.ts` must stay import-free, `lib/intent/**` must stay free of `browser.*`
and DOM (`yarn intent:check` runs it in bare Node), and `lib/actions/registry.ts` must gain
no top-level DOM reference (`yarn mcp:manifest` is that check).

## Library decision: no Ramda

Recommend against it, on four grounds:

1. Ramda's TypeScript types are weak and its curried signatures degrade inference — it works
   directly against the "increase strict typing" goal.
2. Its default build tree-shakes poorly; this bundles into an MV3 content script.
3. The code already uses native `map`/`filter`/`flatMap`/`Object.entries` throughout. The
   imperative residue is *state machines and I/O*, which Ramda does not address.
4. Nothing in Ramda models `ActionResult`, which is the type actually threaded through
   every call path in this project.

Instead:

- **`lib/fn.ts`, hand-rolled, ~60 lines, no dependency.** `pipe`, `flow`, `tap`,
  `assertNever`, and — the important half — combinators over the existing `ActionResult`:
  `mapOk`, `flatMapOk`, `mapErr`, `orElse`, `unwrapOr`, `allOk`. This is the single
  highest-leverage change in the plan; see Phase 1.
- **If a utility belt is still wanted later: `remeda`, not Ramda** — TS-first, tree-shakable,
  `pipe` built in. Scope it to `mcp/` first, where bundle size is irrelevant. Do not import
  it into `lib/skills/format.ts`, `lib/intent/`, or anything a content script pulls in.
- **`zod` is already a dependency on both sides** and is the right tool for the wire types
  (Phase 4). No new package needed.

## Phase 0 — foundations (no behaviour change)

1. `lib/fn.ts` — `pipe`, `flow`, `tap`, `assertNever`, and the `ActionResult` combinators.
2. `lib/result.ts` or fold into `protocol.ts` — keep `success`/`failure` where they are so
   both packages keep importing one module.
3. `scripts/check-purity.mjs` — the project has no lint step and three bare-Node check
   scripts; this follows that convention rather than introducing ESLint. It asserts that
   modules under a declared pure set import nothing from `wxt/browser`, `node:*`, or touch
   `document`/`window`/`browser.` at any scope. Wire into a new `yarn purity:check`.
4. Add to `package.json`: `"check": "yarn compile && yarn compile:mcp && yarn intent:check && yarn security:check && yarn purity:check && yarn mcp:manifest"`. Every phase below is
   gated on this staying green.

No comments in any new module — the repo carries none by design; load-bearing rules go in
`CLAUDE.md`.

## Phase 1 — the Result spine (compose + pipe, for real)

Today every caller unpacks `ActionResult` by hand: `if (!result.ok) return ...`, ~90 times.
That is the imperative pattern the codebase repeats most.

With combinators, the call sites collapse:

- [invoke.ts:125-135](lib/bridge/invoke.ts#L125-L135) `navigateTab` — the in-page-then-tabs-API
  fallback becomes `orElse(isNoContentScript, () => navigateViaTabsApi(...))`, which states
  the documented rule (*only* a pre-delivery failure may retry) as a predicate instead of a
  nested `if` on a substring.
- [service.ts:73-121](mcp/src/agent/service.ts#L73-L121) `invokeForRun` — see Phase 2.
- [fast-path.ts](lib/bridge/fast-path.ts), [run-port.ts](lib/bridge/run-port.ts),
  [socket.ts](lib/bridge/socket.ts) — the `if (!post(frame)) return Promise.resolve(failure(...))`
  preamble repeated five times becomes one `requireLink()` combinator.

Sequence: land `lib/fn.ts`, convert `lib/bridge/invoke.ts` as the pilot (it is self-contained
and has the trickiest control flow), then sweep.

## Phase 2 — collapse duplication into declarative tables

Ordered by payoff.

### 2a. Pending calls over the socket — 4 copies → 1 table

[socket.ts:63-176](lib/bridge/socket.ts#L63-L176) holds four independent `Map`s, four timeout
constants, four `post()` guards, four promise bodies, plus four near-identical `case` arms in
`handle()` at lines 331-353.

Replace with one registry plus a declaration table:

```
const CALLS = {
  analyzeFile:      { reply: 'fileSummary',      timeoutMs: 90_000,  onTimeout: '…' },
  analyzeRecording: { reply: 'recordingWorkflow', timeoutMs: 120_000, onTimeout: '…' },
  nameSession:      { reply: 'sessionName',      timeoutMs: 20_000,  onTimeout: '…' },
  saveSkill:        { reply: 'skillResult',      timeoutMs: 15_000,  onTimeout: '…' },
  …
} as const satisfies Record<string, CallSpec>
```

`handle()` loses four cases in favour of one lookup keyed on `frame.t`. Net: ~115 lines → ~45,
and adding a request/reply pair becomes one table row.

### 2b. Daemon frame dispatch — 7 branches → 1 record

[daemon.ts:197-246](mcp/src/daemon.ts#L197-L246) is three `void X(...).then(send).catch(send-failure)`
blocks and four synchronous `return source.send(...)`. Same envelope every time.

Replace with `Record<ExtensionRequest['t'], (req, deps) => ActionResult | Promise<ActionResult>>`
and one `respond()` that owns the `{ t: <replyFrame>, id, result }` shaping and the catch.
Missing keys become a compile error, which closes the documented trap that a frame absent
from `EXTENSION_REQUEST_FRAMES` is silently dropped.

Do the same for the control-op if-chain at [daemon.ts:287-327](mcp/src/daemon.ts#L287-L327).

### 2c. The index + body store — 4 copies → 1 factory

`CLAUDE.md` counts these out loud ("the third store on the … pattern", "the fourth index+body
store"). All four implement: read index, read `<prefix>:<id>` body, merge-on-write, eviction
cascade that drops the body key with the record.

`lib/bridge/store.ts`:

```
createIndexedStore<Meta, Body>({ indexKey, bodyKey, caps, merge })
  → { list, put, read, remove, subscribe }
```

Each of the four becomes ~25 lines of types + config. This also fixes the divergence risk
`CLAUDE.md` already flags — `putSession` merges (two writers), the others replace; making
`merge` an explicit parameter states which semantics each store chose.

### 2d. Byte-budgeted sections — 2 copies → 1 pure function

`filesBlock` and `recordingsBlock` in [service.ts:356-419](mcp/src/agent/service.ts#L356-L419)
are the same accumulate-until-full loop. Extract:

```
budgetedSections<T>(items, render: (t: T) => string, { maxBytes, overflowNote }): { text?: string; dropped: number }
```

Pure, testable, and the two 30-line loops become 5-line calls. `prompt.ts`'s own 64 KB
overlay budget is the same shape and should use it too.

### 2e. The two scrubbing validators — 2 copies → 1 field-spec interpreter

`validateSiteMapReport` ([lib/skills/site-map.ts](lib/skills/site-map.ts)) and
`validateRecordingWorkflow` ([lib/recordings/workflow.ts:66-212](lib/recordings/workflow.ts#L66-L212))
run identical discipline over different shapes: scrub every leaf, cap every leaf, drop
members outside an allowlist, re-parse URLs against a fixed origin, collect warnings, trim to
a byte budget.

This is the most security-relevant duplication in the tree — both consume text that came off
an attacker-controlled page. Replace the two hand-written walkers with one declarative field
spec both describe themselves in, interpreted by a shared `lib/skills/validate.ts`. One place
to be right, which is the stated reason `lib/skills/scrub.ts` already exists.

Constraint: the result must stay import-free enough to load in a worker and bare Node.

### 2f. `invokeForRun` — a guard chain → an ordered interceptor list

[service.ts:73-121](mcp/src/agent/service.ts#L73-L121) interleaves five concerns in one
procedure: emit `tool`, intercept `browsentic.saveSiteMap`, apply the mapping gate, apply the
approval gate, invoke, emit `toolResult`. The gate *order* is load-bearing and documented
(mapping runs deliberately bypass approval) but currently only legible by reading the
fall-through.

Restructure as an ordered array of `(ctx, next) => Promise<ActionResult>`:

```
const PIPELINE = [withTimeline, interceptSaveSiteMap, mappingGate, approvalGate, dispatchToTab]
```

The order becomes a single readable line, and each stage is independently testable.

### 2g. `effects.ts` — ifs → an effect table

[effects.ts:3-9](mcp/src/agent/effects.ts#L3-L9) hardcodes `page.fillInput`/`page.pressKey`
in an if-chain. Make it a table of `{ action, effect, when }` predicates so adding an action
that submits a form is one row, not an edit to a function two files from the registry.

## Phase 3 — split the large modules

Splits only; no logic changes in this phase, so the diff stays reviewable.

| File | Lines | Split into |
| --- | --- | --- |
| [entrypoints/sidepanel/App.tsx](entrypoints/sidepanel/App.tsx) | 478 | `App.tsx` (layout), `components/app-header.tsx`, `components/composer.tsx`, `components/composer-toolbar.tsx`, `components/attachments-list.tsx`, `lib/bridge/use-composer.ts`, `lib/bridge/use-panels.ts` |
| [mcp/src/agent/service.ts](mcp/src/agent/service.ts) | 482 | `service.ts` (AgentSession), `agent/pipeline.ts` (2f), `agent/context-blocks.ts` (2d), `agent/summarize.ts` |
| [mcp/src/daemon.ts](mcp/src/daemon.ts) | 463 | `daemon.ts` (lifecycle), `daemon/authorize.ts`, `daemon/handlers.ts` (2b), `daemon/control.ts`, `daemon/listen.ts` |
| [components/markdown.tsx](components/markdown.tsx) | 433 | `markdown/blocks.ts` (pure), `markdown/inline.tsx` (pure, **algorithm untouched**), `markdown.tsx` (render) |
| [mcp/src/agent/sitemap.ts](mcp/src/agent/sitemap.ts) | 408 | `sitemap/index.ts`, `sitemap/transport.ts` (pinned lookup + streaming, untouched), `sitemap/parse.ts` (pure), `net/private-address.ts` (pure — already covered by `yarn security:check`) |
| [lib/bridge/socket.ts](lib/bridge/socket.ts) | 382 | `socket/connection.ts` (state machine), `socket/calls.ts` (2a), `socket/frames.ts` |
| [lib/bridge/use-run.ts](lib/bridge/use-run.ts) | 350 | `use-run.ts`, `run-reducer.ts` (pure — `reduce`/`patchTool` already are), `use-run-port.ts`, `use-session-persistence.ts` |
| [lib/recordings/capture.ts](lib/recordings/capture.ts) | 251 | `capture/targets.ts` (pure), `capture/handlers.ts` (listener table), `capture/session.ts` (buffer) |

One correctness fix rides along in `App.tsx`: `skillsOpen` / `recordingsOpen` / `historyOpen`
are three independent booleans representing one mutually-exclusive choice. Collapse to
`activePanel: 'skills' | 'recordings' | 'history' | null` — making the impossible states
unrepresentable is the most declarative change available in that file.

## Phase 4 — strict typing

### 4a. Branded ids

`RunId`, `ToolId`, `StagingId`, `ClaudeSessionId`, `SessionId`, `TabId` in
`lib/actions/protocol.ts`. Every one of these is a bare `string`/`number` today, and
`CLAUDE.md` documents three separate bugs that came from crossing them: `EXTERNAL_RUN_ID`
leaking into `activeRunId`, `sessionId` vs `claudeSessionId` ownership, a `done` frame ending
the wrong run. Brands make those compile errors.

### 4b. `ActionName` as a union

Derive from the registry as a `const` tuple. Then:

- `invokeForHarness(action: ActionName, …)` instead of `string`.
- `ToolName` as a mapped/template-literal type over `ActionName`, which turns half of
  `assertToolNamesRoundTrip` into a compile-time guarantee (a name with two underscores stops
  type-checking rather than failing at daemon startup).
- `REPLAYABLE_ACTIONS`, `requireApproval`, `CONSEQUENTIAL`, and the mapping allowlist all
  narrow from `string[]` to `ActionName[]`, so a renamed action breaks every list that names it.

### 4c. Typed action outputs

Add an output type per action and an `OutputOf<N extends ActionName>` map. This removes the
casts in [service.ts:459-476](mcp/src/agent/service.ts#L459-L476) `summarize()` and
[daemon.ts:56-72](mcp/src/daemon.ts#L56-L72) `persistScreenshot()`, which currently reach into
`result.data` with four separate `as` shapes.

Note the invariant `CLAUDE.md` states: `mcp/src/server.ts` `JSON.stringify`s `result.data`
straight to an ungated MCP client. Typed outputs make "what does this action hand back"
reviewable at the type level, which is exactly where the `fill-input.ts` read-primitive bug
lived.

### 4d. Parse the wire instead of casting it

[protocol.ts:162-169](lib/actions/protocol.ts#L162-L169) `parseFrame` casts after checking
only that `t` is a string. [daemon.ts:290](mcp/src/daemon.ts#L290) casts `ControlRequest` with
no check at all. Replace both with a zod discriminated union — zod is already a dependency on
both sides and already ships in the content script, so this costs nothing new.

### 4e. Stop re-hand-parsing schema'd inputs

The ~36 `(input as { x?: unknown })` casts exist because worker-fulfilled actions
([invoke.ts:43-121](lib/bridge/invoke.ts#L43-L121)) re-derive their own arguments from
`unknown`, despite the action already owning a zod schema in the registry. Parse once at the
boundary with `action.input.safeParse`, hand typed input downstream.

### 4f. tsconfig

Add to both `tsconfig.json` and `mcp/tsconfig.json`:

```
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitReturns": true,
"noFallthroughCasesInSwitch": true,
"noPropertyAccessFromIndexSignature": true
```

Two will hurt, and should be sequenced last:

- `noUncheckedIndexedAccess` produces heavy churn in the two parsers (`markdown.tsx`,
  `sitemap.ts`) where index access is provably in-range. Land it after Phase 3's splits so
  the churn is contained to the pure files.
- `exactOptionalPropertyTypes` breaks the `= x ?? undefined` idiom used for optional fields
  ([use-run.ts:103](lib/bridge/use-run.ts#L103) is one). Fix by making those fields
  `| undefined` explicitly rather than optional.

## Phase 5 — the pure / side-effecting boundary

Declare and enforce, rather than merely intend.

**Pure** (no `browser.*`, no `node:*`, no DOM, no clock, no randomness — enforced by
`scripts/check-purity.mjs`):

`lib/intent/**`, `lib/skills/**`, `lib/recordings/{events,workflow}.ts`,
`lib/actions/{core,dispatch,manifest,registry,tool-names}.ts`, `lib/fn.ts`,
`mcp/src/agent/{effects,prompt}.ts`, `mcp/src/agent/sitemap/parse.ts`,
`mcp/src/net/private-address.ts`, `components/markdown/**`, `lib/bridge/{redact,run-reducer}.ts`

**Effectful, and named as such** — the modules that own I/O, timers, storage and process
spawning: `lib/bridge/{socket,run-port,recorder,invoke}.ts`, `mcp/src/{daemon,server}.ts`,
`mcp/src/agent/{runner,service}.ts`, `lib/actions/page/*` `execute()` bodies.

Two rules that fall out and are worth stating in `CLAUDE.md`:

1. `Date.now()` and `crypto.randomUUID()` are effects. Where a pure function needs them today
   (`stateOf`, `freshSession`, the recording validators), take them as parameters. This is
   what makes the validators testable without a clock.
2. An action's `execute()` is the *only* sanctioned place for DOM in `lib/actions/`. That is
   already the rule; the purity check makes it mechanical.

## Sequencing

Each step is independently landable and gated on `yarn check` staying green.

1. Phase 0 — `lib/fn.ts`, `check-purity.mjs`, the `check` script. *(no behaviour change)*
2. Phase 1 pilot — `lib/bridge/invoke.ts` on the Result combinators.
3. Phase 2a + 2b — socket call table, daemon handler record. *(largest line reduction)*
4. Phase 2c — the store factory.
5. Phase 3 splits — mechanical, one file per commit.
6. Phase 2d–2g — the extracted-and-shared pure helpers, now that files are small.
7. Phase 4a–4e — branded ids, `ActionName`, typed outputs, wire parsing.
8. Phase 4f — tsconfig flags, one at a time.
9. Phase 5 — grow the pure set until `check-purity.mjs` covers the list above.
10. Rewrite the affected `CLAUDE.md` sections *in the same commits*, not after — the file is
    the project's only documentation and every section above cites it.

Rough size: ~2,000 lines touched, of which ~600 are net deletions from the duplication
collapse. Phases 1–3 carry most of the value; Phase 4 carries most of the risk.

## Risks

| Risk | Mitigation |
| --- | --- |
| Manifest hash drift forces lockstep rebuilds mid-refactor | Never touch action names, `.describe()` text, or registry order. `yarn mcp:manifest` after every commit. |
| A security control is refactored into a no-op | `yarn security:check` covers SSRF ranges, approval effects and transcript redaction. Phases 2e/2f/2g touch exactly those — add fixtures *before* refactoring, not after. |
| Intent routing shifts under the grammar refactor | `yarn intent:check` has both-direction fixtures per rule. `lib/intent/` needs almost no work; leave it alone. |
| `exactOptionalPropertyTypes` cascades through the wire types | Land it last, after `parseFrame` is zod-parsed so the shapes are pinned. |
| A pure module gains an import that breaks bare Node | `check-purity.mjs` plus the existing `yarn mcp:manifest` and `yarn intent:check` already run three of them in bare Node. |
| Splitting `markdown.tsx` perturbs the inline scanner | Move the functions verbatim in one commit; any change to `renderInline` goes in a separate, separately reviewed commit. |
