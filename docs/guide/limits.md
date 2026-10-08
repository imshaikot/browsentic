# Limits

Known limitations: what Browsentic needs to run, where its security boundary sits, how well each
agent CLI is contained, and the ceilings compiled into it.

---

## It needs a real browser, open

There is no headless mode. Browsentic drives the browser you are looking at, in your real profile
with your real logins. Close the browser and every tool call returns `EXTENSION_OFFLINE`.

For anonymous fetching of a static page, an ordinary HTTP fetch is the right tool, and faster.

## Pages that refuse content scripts

`chrome://` pages, the Chrome Web Store and the new-tab page cannot host a content script, so most
tools return `TAB_UNREACHABLE` there. `page_navigate` still works and is the way out.

Ordinary sites recover on their own: a tab that loaded before the extension did gets a content
script injected on first contact.

## Several browsers, one run at a time per tab

Several browsers can be paired and connected at once, each with its own side panel. A connection is
superseded only by a newer one from the same browser profile. An optional MCP client outside the
browser reaches one browser at a time, the one you were last in; see [pairing](pair.md).

Within the side panel, one instruction runs at a time **per tab session**; a second in the same tab
returns `RUN_IN_PROGRESS`. Eight tab sessions may be open, and three may run at once across every
connected browser (raise with `maxConcurrentRuns`, ceiling 8).

## Pairing controls which browser, not which process

Pairing binds a browser. It does not authenticate local programs: anything running as your user can
read `~/.browsentic/daemon.json` and drive an already-paired browser through the control port.
**Browsentic assumes your user account is the trust boundary.**

## Prompt injection is a real risk

An agent reading a hostile page can follow instructions embedded in that page. No prompt makes a
model immune to this.

Browsentic has three mitigations, none of them a guarantee:

- page text is [fenced](../internals/guardrails.md#fencing): wrapped in a per-daemon random marker
  with a note that its contents are data, never instructions;
- the system prompt restates that framing around every injected block;
- a run is [scoped](approvals.md#scope-which-sites-a-run-may-reach) to the sites it is about, and
  navigations that would leave, or that carry a large URL payload, are gated.

The design goal is that a successful injection has nowhere to send what it took and cannot act
outside the tab you pointed at. Keep the [approval gate](approvals.md) on for anything
consequential, and be deliberate about running instructions on sites you do not trust.

## Containment of the spawned CLI varies by agent

The side panel spawns a third-party agent CLI as you, with its own file and shell tools. Browsentic
contains it with whatever controls that CLI offers, and they are not equal:

| Agent | Containment |
| --- | --- |
| Claude Code | A per-run tool allowlist plus an explicit deny list; the strongest of them |
| Codex | No per-run tool list; the read-only sandbox is the whole containment, so it can still read any file you can |
| Antigravity | No tool list and no sandbox flag; its built-in tools are governed by your own CLI settings |
| Mistral Vibe (beta) | A per-run tool allowlist; its shell and file tools are never loaded, and every browser tool is granted by name |
| Grok Build (beta) | A per-run tool list, approvals that refuse anything not granted up front, and a sandbox that keeps its writes in its own folder; MCP servers you set up in Grok itself still load |
| Cursor CLI (beta) | Per-run deny rules, where a deny beats every allow including your own; a kernel sandbox is asked for too, but it has no Windows backend and is not depended on |
| Qwen Code (beta) | `--safe-mode` drops every setting of your own (hooks, extensions, bundled skills, MCP servers, permission rules), and deny rules close the shell, the disk and the tools that reach either; because that mode also disables Qwen's own fail-closed tool allowlist, the run's startup line is read back and anything unexpected stops it |
| OpenCode (beta) | A per-run agent whose rules open on a deny for every tool, applied after your own rules, so the model is offered only the browser; external plugins and project config are off, and MCP servers you set up in OpenCode itself still start, with their tools hidden |

The environment is sealed for all of them: cloud keys, registry tokens and database URLs inherited
from your shell are removed before the spawn, keeping only what that agent needs to authenticate.
Details are in [internals/guardrails.md](../internals/guardrails.md#spawn-containment).

## Five of the agents are beta

Mistral Vibe, Grok Build, Cursor CLI, Qwen Code and OpenCode were built by reading each CLI and
checking its flags, its containment and its error texts, but none has carried a whole conversation
end to end yet, so the popup, the docs and the release notes mark them *beta*. In practice:

- a run that fails says why, with the command that fixes it, rather than hanging;
- Vibe's replies arrive a message at a time rather than streaming, and it reports no token counts;
- a free Grok account is rate-limited, and Grok retries quietly for minutes before it gives up;
- Cursor is less fenced off on Windows, where its kernel sandbox has no backend;
- Qwen was written against its source, not a running binary (no provider was configured on the
  machine it was built on), and it needs a provider configured before it will answer at all;
- OpenCode needs a provider signed in, because Zen's free models refuse a run narrowed to the
  browser, and its replies arrive a part at a time;
- the other three agents are untouched: the hooks the five share are covered by the spawn and
  drive tests.

[Choosing an agent](agents.md) has the per-agent detail. Please report what you find.

## Windows is experimental

The Bridge runs on Windows, and its tests run there on every change. On a Windows 11 desktop it has
been set up, paired and driven from the side panel by Claude Code. A cancelled run, the other agents
and the [Windows app](windows-app.md) have not been through that test yet. Until they have:

- **An agent installed with npm is started through the program its `.cmd` names**, never through
  `cmd.exe`, which can pass neither a prompt's many lines nor page text intact. A batch file that is
  not an npm or pnpm shim is reported as *unusable*: set that agent's `bin` to the `.exe` it runs.
- **A command line holds at most 32,767 characters.** Claude Code takes its message on stdin and its
  prompt from a file, so it never meets the limit. Codex's `exec` fallback, Qwen Code and Grok Build
  pass the prompt as an argument, and a turn with long site notes, attached files or fetched data can
  pass it; that run fails saying so, before anything starts.
- **Containment is less proven.** Cursor's kernel sandbox has no Windows backend, so only its deny
  rules apply. Codex's read-only sandbox and Grok's workspace sandbox have not been measured on
  Windows; treat either as less fenced off there than on macOS or Linux.
- **Stopping a run ends the agent and everything it started at once**, because Windows has no signal
  a CLI could clean up on.

Please report what you find.

## MCP clients cannot answer a prompt

For an external client on the optional MCP endpoint, anything the policy would confirm resolves to
**deny**, because there is nobody to ask. That cuts both ways: your client cannot submit a form
through Browsentic unless you waive it with `guardrails.unattended: "allow"`, and if you do waive
it, nothing asks you first. See [MCP clients](mcp-clients.md).

## Speech goes to Google

Voice input uses Chrome's built-in Web Speech API, which streams audio to Google for transcription.
No model is bundled and nothing is downloaded. If that is not acceptable, type instead; replacing
the speech engine is a one-file change.

[Hands-free](features/hands-free.md) listens the same way, for as long as it is on and the browser
is in front, not only while you are talking to it. With its **Hold to talk** switched on, it listens
only while you hold the key.

## Recording and mapping limits

**Recordings** run for at most 15 minutes, follow one tab, live in extension storage rather than on
disk, and drop passwords, hidden fields, one-time codes and card numbers unconditionally.

**Site mapping** is read-only, locked to one host and one tab, and capped at 15 pages / 10
screenshots / 10 minutes by default (ceilings 40 / 24 / 30 minutes). It requires the explicit
`@site-mapper` prefix or the Map button; trigger words alone will not start one.

## Screenshots of very tall pages

Full-page capture stitches viewport tiles, capped at 48 tiles and a 16 384 px canvas side. Beyond
that the bottom is cut off and the result reports `truncated: true`, rather than silently returning
a partial image.

## Nine tools need Chrome's debugger, and Firefox has none

`page_trustedClick`, the two captcha tools, the four [diagnostics](features/diagnostics.md) tools
and the two [page-code](features/page-actions.md) tools are built on the Chrome DevTools Protocol,
which Firefox does not expose. A Firefox build leaves them off the list it offers, so an agent
running there never sees them and the Bridge reports the shorter list as in sync. A stale skill or
recording that still names one gets `UNSUPPORTED`, with a hint. There is no fallback for the
diagnostics tools: a page's console and network activity are not reachable any other way.

On Chrome they carry two visible costs: Chrome shows a **"Browsentic is debugging this browser"**
bar for as long as a debugger is attached, and attaching **fails while DevTools is open** on that
tab, since Chrome allows one debugger per tab. A trusted click holds the attach for about 250 ms; a
diagnostics recording holds it until it is stopped or its timeout fires.

## Diagnostics only see what happened while attached

Console and network events are delivered live and buffered nowhere else, so `page_readConsole` on a
failure that happened before `page_startDiagnostics` returns nothing. The buffers are bounded too
(500 console entries, 1,000 requests), and every read reports how many were evicted.

## Themes do not survive a reload

`page_applyTheme` changes the live document. A navigation or a reload puts the page back the way it
was. See [Theming](features/theming.md).

## Loopback ports

Browsentic Bridge binds the first free port of 8765, 8766, 8767. If all three are taken it will not
start.

## The Bridge's wake-up helper

So that a browser can start Browsentic Bridge when it is down, setup registers a native messaging
host with each browser it finds. Only Browsentic's own extension builds may launch it (the Chrome
Web Store and Edge Add-ons copies by their IDs, the unpacked folder, and the signed Firefox add-on),
and it does nothing but start the Bridge. The trust boundary is unchanged: your user account. Opera,
and Vivaldi and Arc on Windows, are not registered yet, so there the Bridge starts with the app, a
command or an MCP client instead.

## Unpacked extension

An unpacked copy (`setup --unpacked`, or a source build) is not updated by any store, and the
browser will not reload it after a rebuild or an update: press ↻ at `chrome://extensions`. Chrome may
also prompt about developer-mode extensions on each launch. The store copies have neither problem.

---

## See also

- [Approvals](approvals.md): what is gated and why
- [Troubleshooting](troubleshooting.md): when one of these limits causes a problem
- [reference/errors.md](../reference/errors.md): every error code
