---
name: add-action
description: "Author a new VoiceLink action — one edit that registers the extension's page capability AND publishes it as an MCP harness tool. USE FOR: adding a page action / browser capability, creating a new page_* MCP tool, extending lib/actions, scaffolding a defineAction, wiring registry.ts, keeping the capability docs in sync. Runs the driver at .claude/skills/add-action/new-action.mjs to scaffold, wire, and verify. TRIGGERS: new action, add a tool, new capability, page action, MCP tool, defineAction, registry.ts, expose a tool, extend the action layer, add browser action."
argument-hint: "The capability, e.g. 'add page.getAttribute that reads an element attribute' or 'expose a new tool to scroll a specific container'"
---

# Authoring a VoiceLink action (== page capability == MCP tool)

In VoiceLink there is **no separate step to register the harness tool**. One `defineAction()` in `lib/actions/` that you add to `registry.ts` becomes, from that single edit, both the extension's page capability *and* the `page_*` MCP tool — the daemon bundles the same registry (`describeActions()`), so `tools/list` cannot drift from it. This skill's job is to make that one edit correct-by-construction and prove it landed.

> Paths below are relative to the repo root, the unit this skill lives under.

## Run this (agent path)

The driver does the three edits that must stay in lockstep — the action module, the registry import, the registry array — then runs the exact checks a reviewer would and asserts the new tool materialized.

```sh
# scaffold + wire registry + compile + build the tool manifest + assert it published
node .claude/skills/add-action/new-action.mjs create getAttribute "Read an HTML attribute (href, aria-label, data-*) from a targeted element."
```

That prints `✓ manifest publishes it as MCP tool "page_getAttribute"` and a **doc-sync report** (see below). It scaffolds a *valid, compiling* action immediately — but with a placeholder `example` field. Now write the real thing:

1. **Edit** `lib/actions/page/<name>.ts` — replace the placeholder input field(s) and the `execute()` body with the real capability. The scaffold's comments name every load-bearing rule inline.
2. **Re-verify** — this is the loop you repeat while iterating:

```sh
node .claude/skills/add-action/new-action.mjs verify getAttribute
```

`verify` runs `yarn compile` then builds and parses the bundled manifest, confirms your action is present, lists its params, and warns on any field missing a `.describe()`. Run it with no name to just re-check the whole registry (`node .claude/skills/add-action/new-action.mjs verify`).

**Back out cleanly** (removes the file *and* unwires the registry):

```sh
node .claude/skills/add-action/new-action.mjs remove getAttribute
```

`create <name> "<desc>"` accepts a bare camelCase verb (namespaced to `page.`) or a full `namespace.name`. Underscores are rejected on sight — they break the reversible action-name ⇄ tool-name mapping.

## The conventions the scaffold bakes in

These fail at **runtime** or silently corrupt the MCP manifest, not at compile time — the scaffold and `verify` exist to enforce them. Full rationale in `CLAUDE.md` → "Adding an action".

- **No top-level DOM.** Touch `document`/`window` only inside `execute()`. `registry.ts` is imported in plain Node by the daemon; a module-scope `document` throws `ReferenceError: document is not defined` when the manifest builds. `verify` catches this.
- **No underscores in the action name** — irreversible in the tool-name mapping.
- **`.describe()` every input field** — that text is the MCP parameter documentation. `verify` warns if you miss one.
- **No zod `.refine()`/`.transform()`** — they don't survive `z.toJSONSchema()`, so the manifest would silently drop the constraint. Validate inside `execute()` with `throw new ActionError(msg, 'CODE')`, using a stable code (`INVALID_INPUT`, `INVALID_TARGET`, `TARGET_NOT_FOUND`, `TIMEOUT`, `UNSUPPORTED`).
- **Return a small JSON-serializable value** (usually `describeElement(el)`) — it crosses `sendMessage`, so never a DOM node.
- Reuse the shared helpers from `./page/dom` (`targetSchema`, `resolveTarget`, `describeElement`) — the scaffold imports them for you. Study `lib/actions/page/select-option.ts` for the canonical guard-and-return shape.

## Update the capability docs (the driver tells you where)

Adding an action changes counts and tables that are written by hand in three places. `create`/`verify`/`docs` print the current action count and a paste-ready README row:

```sh
node .claude/skills/add-action/new-action.mjs docs
```

Edit each, then re-run `verify`:

- **`.claude/skills/voicelink/SKILL.md`** — the "There are N page tools because there are N actions" count in section 8, and add the tool where relevant. *This is the capability skill that drives the browser; keep it truthful.*
- **`README.md`** — the action table under "## The action layer" (paste the row `docs` printed, then write the real effect).
- **`CLAUDE.md`** — the "`Map` of all N actions" count in the action-layer section.

## Make it callable live (needs a paired browser)

`verify` proves the tool is *published*; it does not load it into a running client. A `page_*` tool becomes callable in the real browser only after **both** sides are rebuilt and reloaded:

```sh
yarn build && yarn mcp:build   # rebuild extension + daemon from the new registry
```

Then: reload the unpacked extension at `chrome://extensions` (Chrome does **not** auto-reload it), and **restart your MCP session** — MCP servers enumerate tools at session start, so a new tool won't appear mid-session. Check alignment with `node mcp/dist/cli.js status` → `manifest: in sync`; `DRIFTED` means one side wasn't rebuilt/reloaded. See the `voicelink` skill for driving the browser once it's live.

## Gotchas

- **"Everything compiles" is not "it works."** A used top-level `document.x` type-checks fine (tsc has DOM types) and only blows up when the manifest bundle loads in Node. Always finish with `verify`, never just `yarn compile`.
- **The new tool is missing from the current session even after a rebuild.** Expected — restart the session. `verify`/`mcp:manifest` read the freshly-built bundle from disk, which is why they're the source of truth here, not your live tool list.
- **`create` refuses an existing file / already-imported name.** That's the guard against half-wired duplicates — pick another name or edit the existing module directly.
- **Don't hand-edit `dist/` or `.wxt/`** — both are generated; your action lives only in `lib/actions/`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `verify` fails at `yarn compile` with an unused-variable error | The scaffold's `example` field/param is still unused after your edits | Use or delete it; the placeholder is meant to be replaced |
| `tool manifest failed … ReferenceError: document is not defined` | Top-level DOM access | Move it inside `execute()` |
| `does not survive the tool-name round trip` from `mcp:manifest` | Underscore in the action name | Rename to camelCase |
| `status` shows `manifest: DRIFTED` | Extension and daemon built from different registries | `yarn build && yarn mcp:build`, reload the extension |

## The driver

[`new-action.mjs`](new-action.mjs) — dependency-free Node, lives beside this file. Commands: `create <name> "<desc>"`, `verify [<name>]`, `remove <name>`, `docs`. It shells out to `yarn compile` and the MCP build, so run it from anywhere inside the repo.
