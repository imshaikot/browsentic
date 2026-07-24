# VoiceLink

**Talk to any web page.** VoiceLink is a Manifest V3 Chrome extension that turns a spoken or typed
instruction into real actions on the tab in front of you — clicking, filling, reading, navigating —
and narrates what it did as it goes.

Three pieces make that work:

- **An action layer** (`lib/actions/`) — 17 declarative, self-describing page capabilities that run
  in the content script.
- **An MCP harness** (`mcp/`) — the same registry exposed as an MCP server, so Claude Code or any
  other MCP client can drive your real, logged-in browser through a local daemon.
- **An agent harness** (`mcp/src/agent/`) — the reverse direction: an instruction typed into the
  side panel spawns **your own Claude Code**, which drives the browser back through that same
  server. There is no Anthropic API client in this repo and no API key anywhere in it.

Built with:

- **[WXT](https://wxt.dev)** — Vite-powered extension framework (auto-generated manifest, HMR, multi-browser builds)
- **React 19 + TypeScript** — UI entrypoints
- **Tailwind CSS v4** — styling via `@tailwindcss/vite`
- **[shadcn/ui](https://ui.shadcn.com)** — the component system used by most modern AI products (Radix primitives + CVA + `lucide-react` icons)
- **[zod](https://zod.dev)** — one schema per action, doubling as its MCP tool definition

## Getting started

```sh
npm install
npm run dev        # builds, launches Chrome with the extension loaded, and hot-reloads
```

Other commands:

```sh
npm run build          # production build → dist/chrome-mv3/
npm run build:firefox  # firefox build
npm run zip            # store-ready zip
npm run compile        # type-check only (tsc --noEmit)
npm run icons          # regenerate placeholder icons in public/icon/
```

To load the production build manually: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/chrome-mv3`.

## What's included

| Surface | File | Notes |
| --- | --- | --- |
| Popup | `entrypoints/popup/` | Press-to-talk mic, instruction box, pairing UI, "open side panel" |
| Side panel | `entrypoints/sidepanel/` | The agent chat: always-on dictation, streamed replies, live tool timeline, approval prompts |
| Background | `entrypoints/background.ts` | MV3 service worker + the action bridge (`describe`/`invoke`) + the MCP daemon link + the run port |
| Content script | `entrypoints/content.ts` | Exposes the action layer in every page (`exposeActions()`) |
| MCP harness | `mcp/` | Installable MCP server + daemon that drives the browser (see below) |
| Agent harness | `mcp/src/agent/`, `mcp/skills/` | Turns typed instructions into agent runs by spawning your own Claude Code (see below) |

```
assets/globals.css     # Tailwind v4 + shadcn theme (violet, dark-mode aware)
components/ui/         # shadcn/ui components (button, badge, card, input, textarea, scroll-area)
lib/actions/           # the declarative page-control action layer (see below)
lib/bridge/            # extension side of the harness (daemon socket, invoke path, speech hooks)
mcp/                   # the installable MCP server + daemon
mcp/skills/            # markdown system prompts the daemon routes instructions to
lib/utils.ts           # cn() helper
public/icon/           # generated placeholder icons
wxt.config.ts          # manifest + Vite/Tailwind config
components.json        # shadcn CLI config
```

### Adding more shadcn/ui components

```sh
npx shadcn@latest add dialog dropdown-menu tooltip
```

Components land in `components/ui/` and import via the `@/` alias (provided by WXT).

## The agent harness — instructions in, actions out

Type an instruction into the side panel (or the popup) of a paired browser and the daemon runs it as an agent: it routes the text to a **skill** (a markdown system prompt from `mcp/skills/`, user-overridable in `~/.voicelink/skills/`), spawns **your own Claude Code** (`claude -p` — your login, your model, no API key anywhere in this repo), and hands it the browser through the same MCP server external clients use. Text streams back token by token; every `page_*` call shows up as a row on the side panel's timeline as it happens; gated actions (`page.submitForm` by default — edit `requireApproval` in `~/.voicelink/config.json`) pause for an Allow/Deny in the panel. Follow-ups resume the same Claude Code session, so "now click the second one" works.

Requires [Claude Code](https://claude.com/claude-code) on your PATH (or `{"claudeBin": "/path/to/claude"}` in `~/.voicelink/config.json`).

## Voice input

Dictation is live, on the browser's own **Web Speech API** (`webkitSpeechRecognition`) — Chrome
streams the audio to Google to transcribe, so there is no model bundled here and nothing to
download.

- [`use-speech.ts`](lib/bridge/use-speech.ts) wraps recognition itself: the mic-permission prompt,
  continuous mode, silence-driven auto-restart, and feature detection.
- [`use-voice-composer.ts`](lib/bridge/use-voice-composer.ts) layers hands-free dictation on top.
  Finalized phrases append to an *editable* buffer and auto-send after ~1.6 s of silence; more
  speech, typing, or an explicit cancel all call the pending send off, so you are never racing a
  timer.

The **side panel** listens by default (persisted under `voicelink:voiceEnabled`, toggled by the mic
button, and muted while a run is in flight or the browser is unpaired). The **popup** is
press-to-talk instead — a popup is destroyed the moment it loses focus and cannot hold continuous
listening. Both surfaces fall back to plain typing when recognition is unavailable or the mic is
blocked.

Swapping in a different speech-to-text engine is a one-file change: [`use-speech.ts`](lib/bridge/use-speech.ts)
is the only module that knows the Web Speech API exists.

## The action layer (`lib/actions/`)

A set of **declarative, first-class functions** that read and control the current web page. Each is a self-describing value — a semantic name, a one-line description, and a [zod](https://zod.dev) input schema — so the same registry drives in-extension calls today and an external **MCP harness** later.

```ts
// lib/actions/page/scroll-to.ts
export const scrollTo = defineAction({
  name: 'page.scrollTo',
  description: 'Scroll the page to an element, an absolute position, or by one viewport.',
  input: z.object({ target: targetSchema.optional(), /* … every field .describe()d */ }),
  execute({ target, position, direction, behavior }) { /* the side effect */ },
});
```

One action per module under `lib/actions/page/`:

| Action | Effect |
| --- | --- |
| `page.getPageInfo` | Snapshot: metadata, viewport/scroll, **semantic layout tree + text diagram**, heading outline, inventory of links/buttons/fields/forms with stable selectors |
| `page.scrollTo` | Scroll to an element, a position, or by a viewport (`up`/`down`/`top`/`bottom`) |
| `page.clickElement` | Realistic click (pointer/mouse sequence + native `.click()`) |
| `page.hoverElement` | Pointer/mouse hover sequence to trigger menus & tooltips |
| `page.focusInput` | Focus an element and place the caret (`start`/`end`/`all`) |
| `page.fillInput` | Type into an input/textarea/contenteditable (React/Vue-compatible), optional Enter |
| `page.selectOption` | Choose a `<select>` option by value, label, or index |
| `page.selectText` | Select an element's text, or the nth match of a phrase (spans inline markup) |
| `page.extractText` | Read rendered text or HTML of an element or the page |
| `page.pressKey` | Send a key with modifiers, with Enter-to-submit emulation |
| `page.submitForm` | Submit a form via `requestSubmit()` (runs validation) |
| `page.waitForElement` | Await `attached`/`visible`/`hidden`/`detached`, with timeout |
| `page.highlightElement` | Flash a temporary overlay on an element |
| `page.navigate` | Open a URL, or go `back`/`forward`/`reload` |
| `page.screenshot` | Capture the tab (full scroll view, viewport, or a targeted element) as a PNG/JPEG — stitched in the background worker; optionally saved under `~/voicelink/screenshot/` and returned as an image the agent can see |
| `page.listFiles` | List the user's files stored in VoiceLink, with their AI-generated summaries (resolved in the background from extension storage) |
| `page.attachFile` | Attach a stored file (by id) to a page's `<input type="file">` — the background reads the bytes, the page sets `input.files` via a `DataTransfer` |

**Targeting** is shared and declarative — most actions take a `target: { selector?, text?, role?, nth? }`, resolved by [`resolveTarget`](lib/actions/page/dom.ts) (visible elements only; text matches the innermost accessible element).

### Calling actions

```ts
import { invokeInActiveTab } from '@/lib/actions/client';
import { fillInput } from '@/lib/actions/page/fill-input';

// Fully typed from the action's schema; returns { ok: true, data } | { ok: false, error }
const res = await invokeInActiveTab(fillInput, { target: { text: 'Email' }, value: 'a@b.com' });
```

- [`client.ts`](lib/actions/client.ts) — `invokeInTab` / `invokeInActiveTab`, typed end-to-end (input is compile-time required when the schema needs it).
- [`host.ts`](lib/actions/host.ts) — `exposeActions()`, run by the content script ([content.ts](entrypoints/content.ts)), dispatches actions in the page.
- [`dispatch.ts`](lib/actions/dispatch.ts) — validates input and returns the `{ ok }` envelope; unknown actions and bad input are structured failures, never throws.

### The MCP harness (`mcp/`)

[`@voicelink/mcp`](mcp/) turns the same registry into an MCP server, so Claude Code (or any MCP client) can drive the browser. It ships two binaries:

| Binary | Role |
| --- | --- |
| `voicelink-mcp` | MCP server on stdio — what an MCP client spawns. Starts the daemon if needed. |
| `voicelink-mcpd` | The daemon: a loopback WebSocket server on `127.0.0.1:8765` (falling back to 8766/8767) |

```sh
npm run mcp:install     # one-time: install the package's own dependencies
npm run mcp:build       # → mcp/dist/
npm run mcp:link        # one-time: put `voicelink-mcp` on your PATH
npm run mcp:manifest    # print the tool manifest (no browser needed)

claude mcp add voicelink -- voicelink-mcp
```

`mcp:link` runs `npm link`, symlinking both binaries into your npm prefix — rebuilds are picked up automatically, and `npm run mcp:unlink` removes them. Without it the CLI still works as `node mcp/dist/cli.js`, but every command below (and the hints the daemon prints) assumes the linked name.

```
Claude Code ──stdio──> voicelink-mcp ──ws(control)──┐
                                                    ▼
                                          voicelink-mcpd (127.0.0.1:8765)
                                                    ▲
                                            ws(extension, Origin-pinned)
                                                    │
                                   background.ts ──> content script ──> execute()
```

The extension dials **out** to the daemon because an MV3 service worker cannot listen for connections. One daemon owns the browser link, so several MCP clients can share one browser.

**Tool parity is structural.** The daemon bundles [`describeActions()`](lib/actions/registry.ts) from this repo, so `tools/list` *is* the registry — 17 page tools plus `voicelink_status`. Dots are illegal in MCP tool names, so `page.clickElement` is exposed as `page_clickElement` ([tool-names.ts](lib/actions/tool-names.ts) round-trips the mapping and refuses collisions). On connect both sides exchange a hash of their manifest ([manifest.ts](lib/actions/manifest.ts)); if an installed extension was built from a different registry the daemon adopts the browser's list and emits `tools/list_changed`.

Three read-only resources avoid spending a tool call on page context: `voicelink://page/current` (full snapshot), `voicelink://page/diagram` (the layout diagram alone — the cheapest useful view), and `voicelink://page/text`.

### Pairing — agent control is off until you turn it on

A freshly installed extension connects to nothing. It dials the daemon only after you redeem a one-time code, so no agent can drive the browser without an explicit, deliberate act:

```sh
voicelink-mcp pair          # prints e.g.  PQC3-3RQ7  (single use, expires in 10 min)
```

Then open the VoiceLink popup, paste the code, and press **Connect**. The daemon consumes the code and issues a long-lived session key that the extension stores; it survives service-worker teardown, daemon restarts, and browser restarts, and dies only when you revoke it.

```sh
voicelink-mcp sessions        # which browsers are paired, and which is live
voicelink-mcp revoke          # unpair everything (or pass one origin)
voicelink-mcp status          # daemon + extension state
voicelink-mcp tools           # the bundled manifest
voicelink-mcp logs            # ~/.voicelink/daemon.log
voicelink-mcp stop
```

**How the daemon decides who may connect.** Any web page can open a WebSocket to loopback, so there are two independent gates:

1. *At the HTTP upgrade*, by handshake `Origin`. Browsers set `Origin` themselves and pages can neither forge nor omit it, so the branches are mutually exclusive: an extension origin takes the extension path, `http(s)` origins get a flat 403, and a header-less local process (the CLI, the stdio server) must present the token from the `0600` lockfile. A web page can never reach the control path.
2. *In the `hello` frame*, by credential. Reaching the extension door proves only that you are **an** extension — a pairing token or a valid session key proves you are **the paired** one. Credentials travel in the frame rather than the URL (the browser `WebSocket` API cannot set headers), so they never land in a log or a process list.

Session keys are bound to the origin that paired them, pairing codes are consumed on first use, and revoking drops any live connection immediately. State lives in `~/.voicelink/auth.json` (`0600`), separate from the lockfile so shutting the daemon down never unpairs your browser.

> The token gates *which browser*, not *which local process*. Anything running as your user can read the lockfile and drive an already-paired browser — that is the real perimeter. And a paired agent reading a malicious page is still susceptible to prompt injection; pairing controls access, not intent.

Extension-page callers still use the in-process bridge on [background.ts](entrypoints/background.ts) (`{ channel: 'voicelink/bridge', op: 'describe' | 'invoke' }`); both routes share [`invokeForHarness`](lib/bridge/invoke.ts).

### Adding an action

Create `lib/actions/page/<name>.ts` exporting a `defineAction({ name: 'page.<name>', … })`, then add it to the array in [registry.ts](lib/actions/registry.ts). Keep every input field `.describe()`d and validate at runtime with `throw new ActionError(msg, 'CODE')` (no zod `.refine`/`.transform`, so schemas stay JSON-Schema-clean).

## Local state & what never reaches the repo

Everything the daemon persists lives under `~/.voicelink/`, outside the working tree:

| Path | Contents |
| --- | --- |
| `~/.voicelink/auth.json` (`0600`) | Pairing session keys, bound to the extension origin that redeemed them. Survives daemon restarts; cleared by `voicelink-mcp revoke`. |
| `~/.voicelink/daemon.json` | The lockfile — port and the control-client bearer token. Deleted on shutdown, so it is deliberately *not* where pairing state is kept. |
| `~/.voicelink/daemon.log` | Run starts/finishes, routed skill, every tool call — `voicelink-mcp logs`. |
| `~/.voicelink/config.json` | Optional: `claudeBin`, `requireApproval`. |
| `~/.voicelink/skills/` | Optional user skills that override the bundled ones by name. |

There are **no credentials in this repository and none to add** — the agent runs on your existing
Claude Code login, and speech goes through the browser's built-in recognition. `.gitignore` still
guards the paths above (plus `.env*`, key material, and the `mcp/bin/` + `mcp/lib/` symlinks that
`npm run mcp:link` creates) so a stray copy of any of them cannot be committed by accident.

## Notes

- The manifest is generated by WXT from `wxt.config.ts` — edit permissions/name there, not in `dist/`.
- Popup and side panel follow the system light/dark preference (`.dark` class toggled in each `main.tsx`).
- The dark-launch Chrome profile used by `npm run dev` is throwaway; see [WXT's browser startup docs](https://wxt.dev/guide/essentials/config/browser-startup.html) to customize it.
