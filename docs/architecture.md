# Architecture

How an instruction becomes a click, end to end.

Browsentic is four processes cooperating over loopback: a browser extension, a local daemon, one
stdio MCP server per client, and — when the side panel is driving — a headless agent CLI. This
document follows a request through all of them, then covers the pieces that make that path safe:
authorization, the shared action registry, the gates, and the state on disk.

---

## 1. Why there is a daemon at all

A Manifest V3 service worker cannot listen for connections. It can only dial out, and it is killed
and revived at the browser's discretion. So the extension is a *client*, and something outside the
browser has to be the meeting point.

That something is the daemon. It owns exactly one live browser link and fans it out to however many
MCP clients want a turn:

```
You ──speak or type──> Extension ──local WebSocket──> Daemon ──spawns──> your agent CLI
                            ▲                                        (claude │ codex │ agy)
                            └──────────────── page actions ─────────────────────┘

Any MCP client ──stdio──> browsentic-mcp ──> the same daemon ──> the same browser
```

Everything binds to `127.0.0.1`. Nothing listens on a public interface, and there is no cloud
component.

---

## 2. The four processes

| Process | Started by | Lives for | Job |
| --- | --- | --- | --- |
| **Extension** | The browser | As long as the browser runs | Owns the tabs. Runs the side panel, the popup, the background service worker and one content script per page. |
| **Daemon** (`daemon-main.js`) | Auto-spawned by the first CLI or MCP client that needs it | Until 30 minutes idle with no extension and no control clients | Owns the browser link, authorization, agent runs, screenshot writes, skill and site-map storage. |
| **MCP server** (`browsentic-mcp`) | The MCP client, over stdio | The client's session | Translates MCP tool calls into daemon control frames. One process per client. |
| **Agent** (`claude -p`) | The daemon, per side-panel instruction | One instruction | Reasons about the instruction and calls page tools. Sandboxed to Browsentic's own MCP server. |

The MCP server is deliberately thin: it holds no browser state. Kill it and the browser link is
untouched, because the link belongs to the daemon.

---

## 3. Transport and authorization

The daemon runs one HTTP server that answers `GET /health` and upgrades everything else to a
WebSocket. It binds the first free port of **8765, 8766, 8767**.

Every upgrade is classified by the handshake `Origin` header before anything else happens:

| `Origin` | Role | Requirement |
| --- | --- | --- |
| `chrome-extension://…`, `moz-extension://…`, `safari-web-extension://…` | `extension` | Proof of a pairing code, or of a session key bound to that same origin |
| Any other value | — | **Refused.** This is what keeps web pages out. |
| Absent | `control` | `Authorization: Bearer <token>` matching the lockfile, compared with `timingSafeEqual` |

Every request — the `/health` endpoint included — must also carry a loopback `Host`. A page whose
own DNS points at `127.0.0.1` still arrives with the attacker's hostname, so rebinding gets a 403
before the `Origin` check even runs.

The split matters because any web page can open a WebSocket to loopback. Browsers set `Origin`
themselves and page JavaScript cannot forge it, so a page reaching the daemon is classified as a web
origin and rejected outright. Native clients send no `Origin`, so they land in the control lane —
where a token they could only have read off the local filesystem is required.

Two independent gates, then: the origin says *what kind of peer this is*, and the credential says
*whether this particular peer is allowed*.

### The control token

24 random bytes, base64url, minted fresh by **each** daemon and written to `~/.browsentic/daemon.json`
with mode `0600`. It dies with the daemon that issued it, so a token that leaked once does not open
every future daemon. Clients re-read the lockfile before every connection, and `probeExisting()`
matches the pid in `/health` against the lockfile so it never offers a token the daemon on that port
never issued. Read it with `browsentic-mcp token`.

### Pairing and sessions

The extension connects to nothing until you pair it.

1. `browsentic-mcp pair` asks the daemon for a code: 8 characters from an alphabet with the
   ambiguous glyphs removed, valid **10 minutes**, single use.
2. You paste it into the Browsentic popup. The extension dials `ws://127.0.0.1:<port>/extension`,
   walking the three ports, and sends `hello` — which names *which* secret it holds and a fresh
   nonce, never the secret itself.
3. The daemon answers `challenge` with a nonce of its own. Both sides now share a transcript:
   protocol version, extension version, manifest hash, and the two nonces.
4. The extension replies `prove` with `HMAC(secret, "browsentic/client" ‖ transcript)`. For a
   pairing code the key is not the code but `PBKDF2(code, nonces, 250 000)`, so recording one
   handshake does not let anyone grind an 8-character code offline.
5. The daemon verifies, then proves *itself*: `welcome` carries
   `HMAC(secret, "browsentic/server" ‖ transcript ‖ the rest of the welcome)`. The two labels are
   distinct, so an impostor cannot reflect the extension's own proof back at it.
6. On pairing, the daemon mints a **session key** (32 random bytes) bound to that extension origin
   and returns it XORed with a keystream derived from the same secret, so the long-lived credential
   never crosses the wire in the clear. It survives browser and daemon restarts and dies only when
   you `browsentic-mcp revoke`.

The mutual half is the point. The three ports are well known and any local process can bind one
first, so an extension that trusted whatever answered could be driven by a squatter. Instead, a
socket that closes without a *verified* `welcome` — a squatter, a daemon from an older protocol, an
`unauthorized` frame, five seconds of silence — is abandoned and the walk moves to the next port.
Only a peer that proves it holds the same secret ever gets to send an `invoke`.

Reconnection is exponential backoff from 1 s to 30 s with jitter, plus a one-minute
`browser.alarms` tick that re-dials if the service worker was torn down in between.

A rejected `hello` comes back as an `unauthorized` frame carrying a `retryable` flag. Nothing has
proved itself at that point, so the extension treats it as a claim rather than a verdict: it notes
the reason, tries the remaining ports, and if none work it reports the error and stops dialling —
but it never deletes the stored key. Only pairing again or `disconnect` replaces it.

### Protocol version

Both sides compile in `SOCKET_PROTOCOL_VERSION` (currently **11**). A mismatch closes the socket with
an explicit reason instead of letting two incompatible frame vocabularies talk past each other.

---

## 4. One registry, two bundles

There are 35 page capabilities. They are defined once, in `lib/actions/registry.ts`, and that array
is compiled into **both** the extension and the daemon.

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

### Names

Action names are dotted (`page.getPageInfo`); MCP tool names are underscored (`page_getPageInfo`).
The mapping is mechanical, and `assertToolNamesRoundTrip()` runs on every `tools/list` to prove that
every name survives the round trip and that no two actions collide. That check is why action names
must not contain underscores — `page.get_info` would come back as `page.get.info`.

### Drift detection

The extension hashes its bundled manifest and sends the hash in `hello`. If it differs from the
daemon's, the daemon:

1. flags `manifestInSync: false` (visible in `browsentic-mcp status` and `browsentic_status`),
2. asks the extension for its actual descriptor list over a `describe` frame and **adopts it** — the
   browser is the authority on what the browser can do,
3. broadcasts `manifest-changed` to control clients, which makes each MCP server emit
   `notifications/tools/list_changed`.

So a half-rebuilt install degrades into "the tools the browser really has", loudly, rather than into
tool calls that fail at the far end.

### Reserved actions

Four names under the `browsentic.` prefix are not page actions:
`browsentic.saveSiteMap`, `browsentic.startRecording`, `browsentic.stopRecording`,
`browsentic.readSitemap`. The daemon refuses any invoke whose action starts with that prefix, so
they are unreachable from an ordinary MCP client. `browsentic_saveSiteMap` is published as a tool
only to the MCP server spawned inside an agent run.

`browsentic_status` is likewise not in the registry — the MCP server answers it directly by
combining daemon state with a one-element `page.getPageInfo` and the current monitor list.

---

## 5. Path A — an MCP client drives the browser

```mermaid
sequenceDiagram
    participant C as MCP client
    participant M as browsentic-mcp
    participant D as Daemon
    participant B as Background SW
    participant P as Content script

    C->>M: tools/call page_clickElement
    M->>D: {op:"invoke", action:"page.clickElement"} (control WS)
    D->>B: {t:"invoke", id, action, input} (extension WS)
    Note over D,B: also emits a timeline event so the user sees it
    B->>P: tabs.sendMessage → dispatch()
    P->>P: zod parse → execute() in the page
    P-->>B: ActionResult
    B-->>D: {t:"result", id, result}
    D-->>M: {op:"invoke", result}
    M-->>C: content[] or isError
```

Details worth knowing:

- **`browsentic-mcp` starts the daemon if needed.** `ensureDaemon()` reads the lockfile, checks the
  pid is alive and `/health` answers, and otherwise spawns a detached `daemon-main.js`, polling for
  up to 8 seconds. It never compares versions, so a running daemon keeps serving an old build until
  `browsentic-mcp restart` (or `stop`) — in the repo, `yarn mcp:restart` chains the rebuild with it.
- **External calls are visible.** The daemon emits a `tool`/`toolResult` pair tagged
  `source: 'external'` on the run channel, so anything an MCP client does appears on the user's
  timeline. It does **not** pass the approval gate — that gate applies to agent runs only.
- **Timeouts are per action, not global.** The control request waits 60 s by default; the
  extension link allows 120 s for a screenshot, the computed typing duration plus 30 s for
  `page.typeText`, any declared `timeoutMs` plus 5 s, and 30 s otherwise.
- **Screenshots are persisted by the daemon**, not the browser, and only on request.
  `persistScreenshot()` writes nothing unless the call passed `save: true` or a mapping run
  supplied a `saveTo` — so the captures an agent takes to look at a page leave no files behind. It
  reads `save` off the *raw* input rather than the parsed one, because the zod default is applied
  in the content script and never reaches the daemon. When it does write, it decodes the data URL
  into `screenshotDir` (default `~/browsentic/screenshot`) at mode `0600` and adds `savedTo` to the
  result. A failed write becomes `saveError` — the capture still succeeds.
- **Three read-only resources** (`browsentic://page/current`, `/diagram`, `/text`) give an MCP
  client page context without spending a tool call. They *throw* on failure rather than returning
  an error result, because MCP resources have no error channel.

---

## 6. Inside the browser: background vs content script

Not every capability can run in the page. The background service worker splits them:

| Handled entirely in the background | Why |
| --- | --- |
| `listFiles`, `attachFile`, `listRecordings`, `readRecording` | The data lives in extension storage |
| `startMonitor`, `monitorStatus`, `awaitMonitor`, `stopMonitor` | Monitors outlive any single page |
| `openTab`, `switchTab`, `closeTab`, `screenshot`, `navigate` | Need the `tabs`/`scripting` APIs |
| Everything else | Forwarded to the content script |

The forwarding call is `invokeInTab()`, and it self-heals. A tab that loaded *before* the extension
did has no content script, so `tabs.sendMessage` fails with `Receiving end does not exist`. The
extension then injects the content script via `browser.scripting.executeScript` and:

- for the four idempotent reads (`getPageInfo`, `extractText`, `waitForElement`, `navigate`) it
  retries immediately;
- for anything that *changes* the page it returns `TAB_UNREACHABLE` with instructions to re-snapshot
  first — because the caller's selectors were computed against a page it has not actually seen.

`onInstalled` also sweeps every open, non-discarded tab and injects there, so a fresh install does
not leave you with a browser full of unreachable tabs.

Pages that refuse content scripts at all (`chrome://`, the Web Store, the new-tab page) stay
`TAB_UNREACHABLE` permanently. `page_navigate` still works there through the tabs API, which is why
it is the documented escape hatch.

### Tab scoping

A panel conversation is **bound to the tab it started in**. The background keeps a registry of tab
sessions in `browser.storage.session` under `browsentic/tabSessions`: each entry maps a `sessionId`
to its main tab, the subtabs its runs opened, the tab its next action should land on, the live tab
title, and the run currently going in it, if any.

Every frame the daemon sends for an agent run carries that run's `runId`, and the extension resolves
it to the owning session's current tab. So a run keeps working in its own tab while the user browses
somewhere else, and two sessions in two tabs act independently. A run that opens a tab with
`page.openTab` adopts it as a subtab; `page.switchTab` onto a tab another session owns is refused
with `TAB_IN_USE`, and if every tab of a session is gone its actions fail with `SESSION_TAB_CLOSED`.

Calls with no run behind them — an external MCP client, the local fast path — still target the
active tab of the current window. A site-mapping run keeps its own older pin, threading a literal
`tabId` and failing with `MAPPING_TAB_CHANGED` if that tab goes away.

Closing a tab ends its session: the run is cancelled, the transcript is flushed to history, and the
entry leaves the registry. Closing the side panel does not — the tab is the anchor, and while a run
is going its tab carries a dot on the toolbar badge and on its favicon.

---

## 7. Path B — the side panel drives the browser

An instruction typed or spoken into the side panel takes a longer road, and it does not always
leave the browser.

### 7a. The intent funnel

`lib/intent/` scores the utterance against a local grammar first. Rules carry a `certainty`, slot
extraction returns a `confidence`, and the product must clear **0.75** to act locally.

Before scoring, four categories escalate unconditionally: anything starting with `@` (an explicit
skill pin), questions, multi-step phrasing (`and then`, `after that`), and hedges (`if`, `unless`,
`try to`). A matched rule flagged `risky` — the label contains *buy*, *pay*, *delete*, *send*,
*submit*, *confirm* and friends — escalates too.

A confident match runs straight through `invokeForHarness` in the background and emits a
`source: 'local'` timeline entry with a bolt. It never reaches the daemon, so it leaves no trace in
`browsentic-mcp logs`. If a local command runs and *fails*, it escalates rather than reporting the
failure.

The bias is deliberate: escalating something the browser could have handled costs a round trip;
acting on something misread spends a wrong click on a real page.

### 7b. The agent run

```mermaid
sequenceDiagram
    participant S as Side panel
    participant B as Background SW
    participant D as Daemon
    participant K as claude -p
    participant M as browsentic-mcp (child)

    S->>B: instruction + the tab it was typed on
    B->>B: resolve tab → session, tryFastPath() — grammar
    B->>D: {t:"instruct", id, text, context (url, tabId, sessionId, files, recordings)}
    D->>D: route skill, build system prompt
    D->>K: spawn with --mcp-config {browsentic}, BROWSENTIC_AGENT_RUN=<runId>
    K->>M: stdio (its only MCP server)
    M->>D: {op:"invoke", runId, action} (control WS)
    D->>D: approval / mapping gate
    D->>B: {t:"invoke", runId, …} → the session's own tab
    B-->>D: result
    D-->>M: result
    M-->>K: tool result
    K-->>D: stream-json deltas
    D-->>S: run events (text, tool, toolResult, approval, done)
```

The loop closes on itself: the daemon spawns the agent CLI, which spawns *another* `browsentic-mcp`,
which connects back to the same daemon. That indirection is what lets an agent run reuse the exact
tool surface an external client gets, while still being gated differently.

The `BROWSENTIC_AGENT_RUN` environment variable is the whole mechanism. The child MCP server reads
it, stamps `runId` on every control invoke, and the daemon routes those to
`AgentSession.invokeForRun()` — the gated path — instead of `invokeExternal()`. It also causes
`browsentic_saveSiteMap` to be published as a tool.

### How the child is sandboxed

`runInstruction()` hands the request to one **runner** — `mcp/src/agent/runners/{claude,codex,antigravity}.ts`
— which turns it into an argv, a working directory and any files that CLI reads from disk. A shared
driver (`runners/drive.ts`) does the spawning, the abort wiring and the line reading; the runner
only decides *what* to say and *how to read the answer back*. Adding a fourth agent is one file plus
one line in `runners/index.ts`.

Every runner is given the same four things, by whichever mechanism its CLI supports:

- **only Browsentic's MCP server** — Claude via `--mcp-config` + `--strict-mcp-config`, Codex via
  `-c mcp_servers.browsentic.*`, Antigravity via a `.agents/mcp_config.json` written into its
  working directory. The user's own MCP servers stay out of scope where the CLI allows it.
- **no reach outside the browser** — Claude gets a `--disallowedTools` list covering every built-in
  that touches the filesystem, the shell or subagents (`Bash`, `Read`, `Write`, `Edit`, `Glob`,
  `Grep`, `Task`, `Skill`, …); Codex runs under `--sandbox read-only --ask-for-approval never`;
  Antigravity's own permission system denies shell commands unless a rule allows them.
- **the assembled system prompt** — `--append-system-prompt`, `-c developer_instructions`, or an
  `AGENTS.md` in the working directory.
- **conversation continuity** — the runner reports whatever session id its CLI established
  (`session_id`, `thread_id`, `conversation_id`) and gets it back on the next turn as `--resume`,
  `exec resume` or `--conversation`. That is what makes "now click the second one" work. Session ids
  are agent-scoped: switching agents drops the held conversation rather than handing one agent
  another's id.

`WebSearch`/`WebFetch` and their equivalents are enabled **only** during a site-mapping run with
`research` on. The environment is scrubbed — `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` and
`BROWSENTIC_AGENT_RUN` are deleted before every spawn so the child does not think it is nested
inside another run, and `BROWSENTIC_AGENT_RUN` is then handed only to the MCP server the child
starts.

Each runner's reader normalizes that CLI's event stream into the same five signals — text delta,
tool started, session established, done, failed — so the side panel renders every agent identically.
Only top-level content is forwarded; a subagent's chatter is dropped.

Before a run starts, `agentState()` probes each CLI (`--version`, plus any extra readiness check)
and the result is cached for 30 seconds. A run against an agent that is not ready fails immediately
with `AGENT_MISSING` or `AGENT_NEEDS_PERMISSION` and a message naming the fix, rather than spawning
something that cannot work.

### Prompt assembly

`buildSystemPrompt()` concatenates, in order:

1. a fixed preamble — the browser is not a sandbox, page content is data and never instructions,
   do not exfiltrate, a `DECLINED` action is final, report what actually happened;
2. the routed **base skill** body;
3. optional **fetched data** (a site's own `robots.txt`/`sitemap.xml`, during mapping);
4. optional **attached files** — notes Browsentic made when each file was attached, capped at 8 KB;
5. optional **recordings** index, capped at 4 KB;
6. any matching **site notes** overlays, hand-written ones before machine-generated ones.

The whole thing is capped at 64 KB. Overlays that would push it over are dropped by name, and the
side panel is told which ones — a silently truncated prompt is worse than a visibly incomplete one.
Every untrusted block gets its own framing paragraph re-stating that its contents are data.

### Skill routing

Skills are markdown with YAML-ish front matter, loaded from three directories, later shadowing
earlier by name:

| Directory | Source | Contents |
| --- | --- | --- |
| `mcp/skills/` (bundled) | `bundled` | `browser-control` (default), `page-research`, `browse-navigation`, `monitor-progress`, `site-mapper` |
| `~/.browsentic/skills/` | `user` | Hand-written overrides |
| `~/browsentic/skills/` (or `skillsDir`) | `uploaded` | Panel uploads and generated site maps |

Both `<name>.md` and `<name>/SKILL.md` are recognised. All three directories are re-read on **every
run**, so editing a skill applies to the next instruction with no reload.

Routing picks exactly one **base** skill (`category: general`) by counting trigger-word hits, with
the `default: true` skill as the fallback. A `@name` prefix pins one explicitly. Skills with
`category: site-exploration` are **overlays** instead: they stack on top of the base whenever the
active tab's host matches their `domains`, longest match first.

---

## 8. The gates

Three distinct mechanisms, often confused:

**Approval.** `requireApproval` in `config.json` (default `["page.submitForm"]`) names actions that
pause an agent run for an explicit Allow or Deny in the side panel. It is smarter than a name match:
listing `page.submitForm` also catches `page.fillInput`/`page.typeText` with `pressEnter: true` and
`page.pressKey` with `Enter`, because those submit forms too. A denial returns `DECLINED` with
instructions not to seek another route to the same effect. **Approval applies to agent runs only** —
direct MCP invocations bypass it, by design, because the MCP client has its own permission system.

**Mapping.** A site-mapping run is gated far harder, and the gate lives in the daemon rather than in
the prompt. Only ten read-only actions are reachable (`MAPPING_READ_ONLY` otherwise); navigation must
be an absolute URL on the mapped origin (`MAPPING_OFF_SITE` for anything else, including `back` and
`forward`, which walk history off-site); page and screenshot budgets are enforced
(`MAPPING_BUDGET`); and the run is pinned to one tab. Drifting off-host blocks every read until it
navigates back.

**Reserved prefix.** The daemon's `invoke()` refuses anything under `browsentic.` outright, so the
mapping and recording control actions are not reachable as ordinary tools.

Config can narrow the mapping limits but never widen them past the compiled ceilings:

| Setting | Default | Ceiling |
| --- | --- | --- |
| `maxPages` | 15 | 40 |
| `maxScreenshots` | 10 | 24 |
| `timeoutMs` | 600 000 (10 min) | 1 800 000 (30 min) |

---

## 9. Subsystems

**Monitors** (`lib/monitor/`, `lib/bridge/monitor.ts`) watch a pinned tab in the background for a
completion condition — an element appearing or vanishing, text or title matching a regex, a progress
bar reaching a threshold. Up to 3 at once, 30 minutes by default and 4 hours maximum, with percent
and ETA extrapolated from the sample history. Completion fires a browser notification; an MCP client
can also long-poll with `page_awaitMonitor`. Sampling is debounced and rate-limited, with a 5-second
backstop tick so a page that stops mutating still gets checked.

**Recordings** (`lib/recordings/`) are the reverse of a monitor: the content script observes what
*you* do in one pinned tab — clicks, fills, selects, keys, submits, scrolls, navigations — for at
most 15 minutes, warning at 13. Events are batched to the background. On stop, a one-shot `claude -p`
call turns the raw trace into ordered, named steps. Typed values become `{{placeholders}}` unless
"Save what I type" is on, and passwords, hidden fields, one-time codes and Luhn-valid card numbers
are dropped either way. Recordings live in extension storage, not on disk, which is why
`browsentic-mcp skills` does not list them and `page_listRecordings` / `page_readRecording` exist.

**Site maps** (`lib/skills/site-map.ts`, `mcp/src/agent/site-map-store.ts`) are generated skills. A
mapping run crawls one host read-only and finishes by calling `browsentic_saveSiteMap` once. The
report is validated against per-field size limits, then written to a `.staging/` directory the skill
loader deliberately cannot read — an unreviewed map is not merely unused, it is never opened. The
panel shows the markdown as plain text with the domain it will match; **Activate** commits it,
**Discard** deletes it. An abandoned run's staging is swept.

**Files** attached in the side panel are stored in the extension and summarised by a one-shot
`claude -p` at attach time. The agent never opens a file; it sees the notes, plus
`page_attachFile { fileId, target }` to put one into a file input.

**Screenshots** stitch `captureVisibleTab` tiles for full-page mode, capped at 48 tiles and a
16 384 px canvas side, reporting `truncated: true` when the page was taller than the limit.

---

## 10. State on disk

Nothing lives in the repository.

```
~/.browsentic/                 (mode 0700, override with BROWSENTIC_HOME)
├── daemon.json    0600        lockfile: pid, port, control token, protocol + daemon version
├── auth.json      0600        outstanding pairing code, session keys per origin
├── config.json                optional, hand-written
├── approvals.json 0600        “always on this site” grants, one action + host per entry
├── daemon.log                 run starts, routed skills, every tool call and its outcome
└── skills/                    hand-written skill overrides

~/browsentic/                  (paths configurable)
├── skills/                    panel uploads + activated site maps
│   ├── acme-com/SKILL.md
│   └── .staging/              maps awaiting review — unreadable to the loader
└── screenshot/    0600        captures taken with save:true
```

Recordings are the exception: they stay in the extension's own storage.

---

## 11. Failure modes

Errors are `{ ok: false, error: { code, message } }` all the way through, surfaced to MCP clients as
`isError` with `CODE: message`. They are recoverable signals, and each implies a different next move.

| Code | Origin | Meaning |
| --- | --- | --- |
| `EXTENSION_OFFLINE` | Daemon | No live browser link. Pair, or open the browser. Retrying will not help. |
| `TAB_UNREACHABLE` | Extension | The page refuses content scripts, or one was just injected. Navigate to an http(s) page, or re-snapshot. |
| `NO_ACTIVE_TAB` | Extension | No focused tab in the current window. |
| `TARGET_NOT_FOUND` | Content script | Nothing matched. The page changed — take a fresh snapshot. |
| `INVALID_TARGET` | Content script | A target with neither `selector` nor `text`. `role`/`nth` only narrow. |
| `INVALID_INPUT` | Dispatch | zod rejected the input; the message names the field. |
| `UNSUPPORTED` | Action | e.g. a non-http(s) URL. |
| `TIMEOUT` | Link or action | A wait expired, or the extension did not answer in the window for that action. |
| `ACTION_FAILED` | Action | `execute()` threw — e.g. `back` with no history. |
| `UNKNOWN_ACTION` | Registry / daemon | Tool-registry skew, or a reserved action reached from outside. |
| `DEBUGGER_UNAVAILABLE` | Extension | Chrome’s debugger could not attach — usually DevTools is open on that tab. Close it, or use `page.clickElement`. |
| `CAPTCHA_NOT_FOUND` | Extension | No known captcha widget on the page, so whatever is blocking the run is something else. |
| `DAEMON_UNREACHABLE` | RemoteBridge | The daemon died mid-call. |
| `RUN_IN_PROGRESS` | AgentSession | One instruction at a time *per tab session*; other sessions are unaffected. |
| `RUN_LIMIT` | AgentSession | Too many sessions running at once (`maxConcurrentRuns`, default 3). |
| `SESSION_LIMIT` | Extension | Eight tab sessions are already open. |
| `SESSION_TAB_CLOSED` | Extension | Every tab this conversation was working in has been closed. |
| `TAB_IN_USE` | Extension | That tab belongs to another Browsentic conversation. |
| `RUN_INACTIVE` | AgentSession | The run was cancelled while a tool call was in flight. |
| `DECLINED` | Approval gate | The user said no. Final. |
| `AGENT_MISSING` | Runner | The chosen agent's binary is not on the daemon's PATH. |
| `AGENT_NEEDS_PERMISSION` | Runner | Antigravity has no rule allowing Browsentic's MCP tools. |
| `MAPPING_*` | Mapping gate | Read-only, off-site, budget or tab-change refusal. |

Two design choices show up repeatedly here: failures carry the *fix* in the message, and a failed
tool call never crashes a run.

---

## 12. Build topology

Two Yarn projects with separate lockfiles.

| | Extension | Daemon + MCP |
| --- | --- | --- |
| Root | `/` | `/mcp` |
| Bundler | WXT (Vite) | tsup |
| Output | `dist/chrome-mv3` | `mcp/dist` |
| Stack | React 19, Tailwind v4, shadcn/ui, zod | Node ≥20, `@modelcontextprotocol/sdk`, `ws`, zod |
| Build | `yarn build` | `yarn mcp:build` |

`mcp/` imports `lib/` through the `@/` alias, which is how one registry ends up in two bundles.
`node scripts/setup.mjs` (`yarn setup`) runs all four steps — both installs, both builds — using the
Yarn release vendored in the repository, so a fresh clone needs nothing on `PATH` but Node.

Verify the two halves agree with `yarn mcp:manifest`, which prints the tool manifest without needing
a browser at all.

---

## 13. Adding a capability

Write `lib/actions/page/<name>.ts` and add it to the array in `lib/actions/registry.ts`. That single
edit publishes it as an MCP tool, because the daemon bundles the same registry.

Four conventions are load-bearing at runtime rather than at compile time:

1. Touch `document`/`window` only inside `execute()` — the module is also imported by the daemon,
   where there is no DOM.
2. No underscores in action names — they break the tool-name round trip.
3. `.describe()` every input field — the text becomes the tool's JSON Schema documentation.
4. Validate with `ActionError` inside `execute()`, not zod `.refine()`/`.transform()` — those do not
   survive JSON Schema conversion.

Then rebuild **both** halves and reload the extension at `chrome://extensions`; Chrome does not
auto-reload unpacked extensions, and a stale service worker is the usual cause of a drifted
manifest.
