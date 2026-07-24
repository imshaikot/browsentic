# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Skills

Project skills live in `.claude/skills/<name>/SKILL.md` and are invoked with a leading slash (`/<name>`) or picked up automatically when the request matches their `description` triggers.

| Skill | Use it for |
| --- | --- |
| [`/voicelink`](.claude/skills/voicelink/SKILL.md) | Driving the user's real browser through the MCP harness — the preflight check, targeting strategy, the error-code → next-move table, navigation edge cases, and the safety rules that apply because these tools act on a live logged-in session. |

Read the skill before calling any `page_*` or `voicelink_*` tool; it encodes failure modes that are not obvious from the tool schemas.

## Project

VoiceLink is an AI voice assistant Chrome extension (Manifest V3) built with WXT (Vite-based extension framework), React 19, TypeScript, Tailwind CSS v4, and shadcn/ui. Its core is a declarative **action layer** (`lib/actions/`) of page-control capabilities designed to double as MCP tool definitions. The AI chat and voice features are still mocked; the scaffold marks where to wire them in.

## Commands

```sh
npm run dev            # build + launch Chrome (throwaway profile) with the extension loaded, HMR
npm run dev:firefox    # same, for Firefox
npm run build          # production build → dist/chrome-mv3/
npm run compile        # type-check only (tsc --noEmit) — the only check tooling; no lint or tests configured
npm run zip            # store-ready zip
npm run icons          # regenerate placeholder icons in public/icon/
npx shadcn@latest add <component>   # add shadcn/ui components → components/ui/
```

The MCP harness lives in `mcp/` and is a **separate npm package** with its own `node_modules`, `tsconfig.json`, and dependency install:

```sh
npm run mcp:install    # one-time; `npm install` at the root does NOT cover mcp/
npm run mcp:build      # tsup → mcp/dist/ (bundles lib/actions via the @/* path alias)
npm run mcp:link       # one-time; puts `voicelink-mcp` on PATH (npm run mcp:unlink undoes it)
npm run compile:mcp    # type-check mcp/ (the root `npm run compile` excludes it)
npm run mcp:manifest   # build + print the tool manifest from plain Node — no browser
```

Docs and daemon-printed hints all use the bare `voicelink-mcp` name, so `mcp:link` is effectively required for the documented workflow; without it, invoke `node mcp/dist/cli.js` instead.

`npm run mcp:manifest` is the standing check that no action gained a top-level DOM reference: it loads the shipped bundle in bare Node, where `document` at module scope throws on import.

`npm run compile` depends on generated types in `.wxt/` — run `npm install` (its postinstall runs `wxt prepare`) if they're missing.

## Architecture

### WXT conventions

- **The manifest is generated.** WXT builds `manifest.json` from `wxt.config.ts` (name, permissions: `storage`, `activeTab`, `sidePanel`, `alarms`, `scripting` + host access for content-script re-injection) plus filesystem conventions in `entrypoints/`: `background.ts` → service worker, `content.ts` → content script, `popup/index.html` → action popup, `sidepanel/index.html` → side panel. Never edit anything in `dist/` or `.wxt/` — both are generated.
- **Auto-imports.** In `entrypoints/`, `browser`, `defineBackground`, `defineContentScript`, etc. are globals injected by WXT (typed in `.wxt/types/`). Code in `lib/` imports explicitly from `wxt/browser` instead. The `@/` alias maps to the project root and comes from `.wxt/tsconfig.json`, which the root `tsconfig.json` extends.
- **Styling.** Tailwind v4 via the `@tailwindcss/vite` plugin in `wxt.config.ts` — no `tailwind.config` file; the theme lives in `assets/globals.css`. Dark mode: each entrypoint's `main.tsx` adds `.dark` to `<html>` based on `prefers-color-scheme`.

### The action layer (`lib/actions/`)

Each action is a frozen value from `defineAction()` (`core.ts`): a namespaced name (`page.clickElement`), a one-line description, a zod input schema, and an `execute()` that runs **in the page** (content-script context). The same declarative shape drives typed in-extension calls today and MCP tool definitions later. The pieces:

- `registry.ts` — the `Map` of all 17 actions, plus `describeActions()` → `[{ name, description, inputSchema }]` with JSON Schema (`io: 'input'`, so defaulted fields stay optional and the manifest matches what `dispatch` actually accepts).
- `dispatch.ts` — validates input against the schema and runs the action; always returns the `{ ok: true, data } | { ok: false, error: { code, message } }` envelope, never throws (`UNKNOWN_ACTION`, `INVALID_INPUT`, or the action's own `ActionError` code).
- `host.ts` — `exposeActions()`, called by the content script; listens on the `voicelink/action` channel and dispatches in the page.
- `client.ts` — `invokeInTab` / `invokeInActiveTab`: typed callers usable from any extension context. Passing the action object (not the string name) gives compile-time input typing — and the `input` argument is *required* when the schema has required fields. Transport failures come back as `TAB_UNREACHABLE` / `NO_ACTIVE_TAB` rather than throwing.
- `protocol.ts` — the two message channels: `voicelink/action` (extension → content script, one invocation) and `voicelink/bridge` (extension pages or external MCP harness → background worker; `op: 'describe'` returns the tool manifest, `op: 'invoke'` routes an action to the active tab). `background.ts` implements the bridge. `index.ts` re-exports the public API.
- `page/dom.ts` — shared targeting: most actions take `target: { selector?, text?, role?, nth? }`, resolved by `resolveTarget()` (visible elements only; text matches against accessible text, keeping the innermost match). `resolveTarget(target, { includeHidden: true })` opts out of the visibility filter — only `wait-for-element.ts` does, so its `attached`/`hidden`/`detached` states can observe hidden elements.
- `page/keyboard.ts` — `keyboardInit(key, modifiers)` builds a realistic `KeyboardEventInit`, including legacy `keyCode`/`which` so older handlers fire. Used by `press-key.ts` and `fill-input.ts`.

Call path: side panel / bridge → `invokeForHarness` → `browser.tabs.sendMessage` → content script `exposeActions` → `dispatch` → `action.execute` in the page.

### The MCP harness (`mcp/`, `lib/bridge/`)

`mcp/` is an installable package (`voicelink-mcp` on stdio, `voicelink-mcpd` as the daemon) that exposes the registry as MCP tools. The daemon owns a loopback WebSocket server; the extension connects **out** to it, because an MV3 service worker cannot listen.

- **Parity is structural, not conventional.** The daemon bundles `describeActions()` from `lib/actions/registry.ts` (tsup resolves `@/*` → repo root), so `tools/list` cannot drift from the registry within a build. Adding an action to `registry.ts` is the *only* step needed to expose a new MCP tool.
- **Names.** MCP tool names cannot contain dots, so `page.clickElement` ⇄ `page_clickElement` via `lib/actions/tool-names.ts`. The mapping is only reversible while no action name segment contains an underscore — `assertToolNamesRoundTrip()` enforces this at startup and in `voicelink-mcp tools`.
- **Wire types are shared, not copied.** `SocketFrame` and the `ActionResult` envelope both live in `lib/actions/protocol.ts` and are imported by both sides; `lib/actions/manifest.ts` hashes the manifest so a version-skewed extension is detected on connect.
- **Never import `@/lib/actions` (the index) from `mcp/`** — it re-exports `client.ts`/`host.ts`, which import `wxt/browser` and break in Node. Import the specific modules.
- **Auth is two independent gates.** At the HTTP upgrade the daemon classifies the peer by handshake `Origin` (extension scheme → extension path; `http(s)` → 403; absent → control client, lockfile token required). That only proves the peer is *an* extension; the `hello` frame must then carry a one-time `pairingToken` or a session key bound to that same origin. Credentials ride in the frame because the browser `WebSocket` API cannot set request headers, and a URL query would leak into logs.
- **The extension is off by default.** `connectDaemon()` returns without dialing unless `storage.local` holds a session key, so an unpaired browser never contacts the daemon. Pairing state lives in `~/.voicelink/auth.json` (`0600`) — deliberately *not* the lockfile, which is deleted on shutdown.
- Verified: Chrome does send `Origin: chrome-extension://<id>` from an MV3 worker.
- **The wire protocol is v2**: on top of the v1 request/reply frames, the extension may send `instruct`/`cancel`/`decision`/`reset` unprompted, and the daemon streams `run` frames back. `assertToolNamesRoundTrip` aside, protocol bumps require rebuilding both sides *and* reloading the extension — a v1 worker is refused at `hello`.
- **Navigation is special-cased** in `lib/bridge/invoke.ts`. It tries the in-page action first (pushes history) and falls back to `browser.tabs.update` only when `sendMessage` fails with "Receiving end does not exist" — a pre-delivery error proving the action never ran. Any other failure means the page already unloaded and is navigating, so re-issuing would navigate twice.
- **Service-worker lifetime.** Daemon pings every 20s reset Chrome's 30s idle timer; a 1-minute `alarms` tick is the only thing that can revive the worker once it is torn down.

### The agent harness (`mcp/src/agent/`, side panel)

The reverse direction of the MCP harness: a free-text instruction typed (or spoken) into the extension travels **out** over the same socket, and the daemon runs it as an agent that drives the browser back. There is deliberately no Anthropic API client anywhere — the daemon spawns the user's own **Claude Code** (`claude -p`), so the user's existing login, model choice and limits apply, and no API key ever exists in this codebase.

Call path: side panel/popup → `runtime.connect` port (`lib/bridge/run-port.ts`) → background → `instruct` frame (`lib/bridge/socket.ts`) → daemon → `AgentSession` (`mcp/src/agent/service.ts`) → `claude -p` (`mcp/src/agent/runner.ts`). The spawned Claude Code gets browser tools through our own stdio MCP server: `--mcp-config` points it back at `dist/cli.js` with `--strict-mcp-config`, so its tool calls loop through the daemon and out to the content script like any other MCP client's. Everything else it could touch is disabled via `--disallowedTools`.

- **Run identity is the safety boundary.** The spawn carries `VOICELINK_AGENT_RUN=<runId>`; `RemoteBridge` attaches it to every invoke, and the daemon routes tagged invokes through `AgentSession.invokeForRun` — which emits the timeline `tool`/`toolResult` events, applies the approval gate (`requireApproval` in `~/.voicelink/config.json`, default `page.submitForm`), and refuses invokes whose run is no longer active (a cancelled agent cannot keep driving).
- **Skills are markdown system prompts** in `mcp/skills/*.md` (bundled; `~/.voicelink/skills/` overrides by name, reloaded every run). Front-matter: `name`, `description`, `triggers: [...]`, `default: true`. Routing: `@name` prefix wins, else most trigger hits, else the default. The body is passed via `--append-system-prompt` on top of the frozen preamble in `mcp/src/agent/prompt.ts`.
- **Conversation continuity is Claude Code's own session store**: first run passes `--session-id`, follow-ups `--resume`; the side panel's clear button sends `reset`, which just forgets the id.
- **Run events** (`RunEvent` in `lib/actions/protocol.ts`) stream daemon → extension as `run` frames; the background worker fans them out to extension pages over a long-lived `runtime.connect` port (streamed text arrives token by token — `storage.session` would be wrong here). If no page is watching, the run is cancelled after a grace period.
- `voicelink-mcp logs` is the debugging surface: every run start/finish, routed skill, and tool call lands in `~/.voicelink/daemon.log`.

### Adding an action

One module per action: `lib/actions/page/<name>.ts` exporting `defineAction({ name: 'page.<name>', … })`, then add it to the array in `registry.ts`. That single edit also publishes it as an MCP tool. The conventions below are load-bearing — breaking them fails at runtime or silently corrupts the MCP manifest, not at compile time:

- **No top-level DOM access.** Touch `document`/`window` only inside `execute()`. `registry.ts` is imported by the background worker (for `describeActions()`), by the MCP daemon, and by plain Node, where a top-level DOM reference throws at import time. `npm run mcp:manifest` is the check.
- **No underscores in action names** — they break the round trip to MCP tool names.
- **`.describe()` every input field** — that text becomes the MCP tool's parameter documentation.
- **No zod `.refine()`/`.transform()`** — they don't survive `z.toJSONSchema()`. Validate inside `execute()` with `throw new ActionError(msg, 'CODE')`, using a stable code: `INVALID_INPUT`, `INVALID_TARGET`, `TARGET_NOT_FOUND`, `TIMEOUT`, `UNSUPPORTED`.
- **Return a small JSON-serializable result** (usually `describeElement(el)`). It crosses `sendMessage`, so never put a DOM node in it — read form attributes with `getAttribute('action')`, since a control named `action`/`method` shadows the IDL property with an element.
- **Write to inputs through the native prototype setter** (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, next)`) then dispatch `input`/`change`. React/Vue ignore direct `.value` writes on controlled inputs. See `fill-input.ts`, `press-key.ts`, `select-option.ts`.
- **Synthetic events perform no default action.** Dispatched keys don't insert text or submit forms, so actions emulate that explicitly — and honor cancellation by checking `dispatchEvent()`'s return value before emulating.
- Keep comments to genuine DOM quirks only; the layer is deliberately low-noise.

## AI integration points

- **Chat responses:** real — the side panel's composer sends instructions through the agent harness (see above); replies and tool activity stream back into `RunTimeline`.
- **Voice input:** real, via the browser's Web Speech API (`webkitSpeechRecognition` — Chrome streams the audio to Google to transcribe; no bundled model). `lib/bridge/use-speech.ts` wraps recognition (mic-permission prompt, continuous mode, silence-driven auto-restart, feature detection); `lib/bridge/use-voice-composer.ts` layers hands-free dictation on top — finalized phrases append to an editable buffer and auto-send after a short silence, with any of {more speech, typing, cancel} calling off the pending send. The **side panel** listens by default (persisted `voicelink:voiceEnabled`, toggled by the mic button); the **popup** is press-to-talk, since a popup dies on blur and can't hold continuous listening. Both surfaces fall back to typing when recognition is unavailable or the mic is blocked. STT swap-out point is `use-speech.ts` alone.
- **Page context:** the side panel's paperclip button calls the `page.getPageInfo` action on the active tab and splices the result into the prompt.
