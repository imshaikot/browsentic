# Troubleshooting

Symptom, cause, fix. For what an error *code* means, see [reference/errors.md](../reference/errors.md).

---

## Start here

```sh
browsentic status      # daemon, extension, manifest sync, pairings
browsentic agent       # which agents are installed, which one runs the side panel
browsentic logs        # run starts, routed skills, every tool call and its outcome
```

Those three answer most questions. The daemon log also lives at `~/.browsentic/daemon.log`.

---

## Setup and connection

| Symptom | Cause | Fix |
| --- | --- | --- |
| Popup shows `Expected {op:…}` | Stale service worker after a rebuild | `chrome://extensions` → ↻ reload Browsentic |
| "That pairing code is wrong or expired" | Codes are single-use and last 10 minutes | `browsentic pair` for a fresh one. A failed attempt does not burn the outstanding code |
| "No Browsentic daemon is running" | Nothing on 8765–8767 | `browsentic status`; check `browsentic logs` |
| `browsentic: command not found` | The global npm prefix is not on `PATH` | `npm prefix -g`, then add its `bin` directory |
| "Browsentic has not been given the microphone yet" | A browser cannot show its microphone prompt inside a side panel or a popup, so a fresh install has never been asked | Press **Allow microphone** and choose **Allow** in the tab that opens |
| "Microphone access is blocked" | The microphone was refused for the extension | Press **Allow microphone**, then click the icon at the left of that tab's address bar and set **Microphone** to **Allow** |
| "This browser has no speech service" | Brave and some Chromium builds ship speech recognition without a transcription service behind it | Type instead, or use Chrome or Edge for dictation |
| No detach button in the panel's header, and no `/hands-free` | Hands-free is offered only where speech can be transcribed — never in Firefox or Brave, and not in a browser whose speech service has failed before it ever worked | Use Chrome or Edge. If the service was only out of reach, dictate in the panel once: the first word it transcribes brings the button back |
| "Hands-free is not available here", and the mic left the page | The speech service failed before it had ever transcribed a word in this browser | As above. Open Browsentic from the toolbar to carry on by typing |
| The hands-free mic turns amber and says another page took the microphone | Chrome runs one speech recognizer at a time, and another page or the panel started one | Press the mic to take it back |
| Holding Control does nothing | Hold to talk is off; the key went to a frame embedded in the page (some editors); another key or a click joined it; or the mic is muted | Turn **Hold to talk** on from the mic's menu, click the page outside the embedded editor, and hold left Control on its own |
| `EXTENSION_OFFLINE` | Browser closed, or not paired | Open the browser; `browsentic sessions` to check pairing |
| "Load unpacked" cannot see `~/browsentic` | A Flatpak or Snap browser, sandboxed away from your home directory. Snap Chromium is the Ubuntu default | Grant it: `flatpak override --user --filesystem=~/browsentic com.google.Chrome`. Or install somewhere the sandbox can read: `browsentic setup --dir ~/snap/chromium/common/browsentic-extension` |
| The folder picker does not show `~/browsentic` | It is there; some pickers open elsewhere by default | macOS: press ⇧⌘G and paste the path. Linux: Ctrl+L |
| Updated with `npx`, but the browser still runs the old build | Chrome never auto-reloads an unpacked extension | `browsentic status` names both versions. Press ↻ on the Browsentic card |
| `browsentic update` says "already current" forever, and reinstalling still lands on an old build | npm's `npx` cache serves the version it first resolved and never asks the registry again | `browsentic update` now replaces the cached command before installing. To clear it by hand, delete every `~/.npm/_npx/*` directory containing `node_modules/browsentic` |
| Deleted `~/.browsentic`, but a daemon is still holding port 8765 | The lockfile went with it; the process did not notice | `browsentic stop` probes the ports rather than the lockfile, so it finds that one. `browsentic uninstall` does it as part of the sweep |

## MCP clients

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tools missing from a session | The server was registered mid-session | Restart the client session — MCP servers load at start |
| A tool call is refused as needing approval | External callers cannot answer a prompt, so `confirm` becomes deny | Do it from the side panel, or set `guardrails.unattended: "allow"` — [read this first](approvals.md#callers-with-nobody-to-ask) |
| `page_extractText` with `format: "html"` is denied | `raw-html-read` is denied by default | Use the default text format, or `{"guardrails":{"rules":{"raw-html-read":"allow"}}}` |
| `page_readNetwork` with `includeBodies` is denied | `network-body-read` is denied by default | Read status, timing and `includeHeaders` instead, or set `{"guardrails":{"rules":{"network-body-read":"allow"}}}` |
| `page_readConsole` comes back empty | Nothing was attached when the error happened | `page_startDiagnostics` **first**, then reproduce. `reload: true` catches load-time errors |
| `DEBUGGER_UNAVAILABLE` on `page_startDiagnostics` | DevTools is open on that tab — Chrome allows one debugger per tab | Close DevTools and retry |
| `manifest: DRIFTED` | Extension and CLI built from different registries | `yarn build && yarn daemon:restart`, then reload the extension |

## Agents

| Symptom | Cause | Fix |
| --- | --- | --- |
| `AGENT_MISSING` | The chosen CLI is not on the *daemon's* `PATH` | `browsentic agent` to see every agent; set `agents.<name>.bin` to an absolute path in `config.json` |
| `AGENT_NEEDS_PERMISSION` | Antigravity has no rule allowing Browsentic's MCP tools | Press the button in the popup, or `browsentic agent fix antigravity` |
| `AGENT_NEEDS_PERMISSION` for Grok Build | It is not signed in | `grok login`, or set `XAI_API_KEY` |
| "does not understand the flags Browsentic uses" | The agent CLI is too old | Update it |
| The model select says *built-in list*, with a reason | Browsentic could not read that CLI's own model list — usually it is signed out | Sign the CLI in, then **Recheck**; `browsentic agent models <name> --refresh` shows the reason in full |
| Mistral Vibe fails with *has no API key* | Vibe was never set up, or its key lives only in a shell the daemon was not started from | `vibe --setup`, which stores it in `~/.vibe/.env` |
| Antigravity answers but never touches the page | Its permission rule was removed | `browsentic agent` — it reports *needs setup* again |
| Codex fails with "not logged in" | The daemon inherits no session | `codex login`, then retry |
| Codex answers about the page without opening it, or from a web search | Codex defers an MCP server's tools until the model searches for them, so a web search is the tool it can see; an older Browsentic also failed to switch that search off | Update Browsentic; the run now says where its browser tools are and switches web search off |
| Codex sees only part of a long page | Codex cuts a tool result over 25,000 tokens; an older Browsentic left its 10,000 default in place | Update Browsentic, then ask for less at a time: a smaller `maxPerKind`, or `page_extractText` group by group |
| Mistral Vibe: every action on a follow-up turn fails with `RUN_INACTIVE` | Vibe re-reads a resumed session from the folder it began in, and an older Browsentic wrote each turn to a folder of its own | Update Browsentic, then start a new conversation: one begun before the update keeps its first folder |
| Grok Build sits silent for minutes, then fails with *xAI did not answer* | The Grok account is rate-limited, as a free one is; Grok retries quietly before giving up | Wait, or upgrade the account |
| Cursor CLI fails with *Authentication required* | The daemon inherits no session | `cursor-agent login`, or set `CURSOR_API_KEY` |
| Cursor CLI reaches an MCP server you did not expect | A project `.cursor/mcp.json` does not replace your global one, so every server you gave Cursor loads too | Browsentic denies each by name for the run; if one still answers, update Browsentic and report it |
| Cursor CLI is less fenced off on Windows | Cursor's kernel sandbox has no Windows backend | Nothing to do — the deny rules still apply; treat a Windows run as `host`-class |
| `AGENT_UNSAFE`: *Grok Build offered this run …* | Grok offered tools Browsentic never asks for, so the run was stopped before the model saw them | Update Grok Build and Browsentic; report it if it persists |
| Qwen Code fails with *No auth type is selected* | Qwen has no provider configured, and its OAuth free tier ended on 2026-04-15 | Run `qwen` and use `/auth`, or export `OPENAI_API_KEY` with `OPENAI_BASE_URL` |
| Qwen Code cannot see an API key you exported | Only `QWEN_*`, `DASHSCOPE_*`, `BAILIAN_*` and `OPENAI_*` reach a run; the rest are sealed away | Point Qwen at one of those four providers |
| `AGENT_UNSAFE`: *Qwen Code registered …* / *loaded the MCP server …* | Qwen's own startup line named a tool or a server Browsentic denied, so the run was stopped before the model saw it | Update Qwen Code and Browsentic; report it if it persists |
| OpenCode fails with *free models refuse a run whose tools Browsentic has narrowed to the browser* | OpenCode Zen's free tier serves only requests carrying OpenCode's own built-in tools | `opencode auth login`, then pick that provider's model in the popup |
| OpenCode fails with *could not start this turn* | Usually a model OpenCode does not know | Pick one as `opencode models` lists it, `provider/model` |
| OpenCode cannot see an API key you exported | Only `OPENCODE_*` reaches a run; the rest are sealed away | `opencode auth login`, which keeps the key in OpenCode's own file |
| `AGENT_UNSAFE`: *OpenCode ran its own … tool* | A tool outside the browser ran despite the run's rules, so the run was stopped | Update OpenCode and Browsentic, and report it |

## Pages and tabs

| Symptom | Cause | Fix |
| --- | --- | --- |
| `TAB_UNREACHABLE` on a normal site | The extension needs reloading | ↻ at `chrome://extensions`; ordinary sites otherwise self-heal |
| `TAB_UNREACHABLE` on `chrome://`, the Web Store, the new-tab page | Those pages cannot host a content script | `page_navigate` to an http(s) page — it still works there |
| `TARGET_NOT_FOUND` for something clearly on screen | The page changed since the snapshot, or it is inside a captcha widget's shadow root | Re-snapshot with `page_getPageInfo`; for a captcha use [`page_solveCaptcha`](features/captcha.md) |
| A captcha keeps setting new image challenges | The vendor distrusts the browser, however well each round is answered — common with automated or headless browsers | Solve one round yourself in the page; a person's answer usually clears the distrust. See [Captchas](features/captcha.md#image-challenges) |
| `DEBUGGER_UNAVAILABLE` | DevTools is open on that tab | Close DevTools, or use `page_clickElement` instead of `page_trustedClick` |
| `RUN_IN_PROGRESS` | One instruction at a time per tab | Cancel the running one, or use another tab |
| `TAB_IN_USE` | That tab belongs to another Browsentic conversation | Switch to it from the Sessions strip |

## Behaviour that looks wrong but is not

| Symptom | Why |
| --- | --- |
| An action ran but nothing appears in `logs` | It matched the local intent grammar and never reached the daemon. Those carry a ⚡ on the timeline. Explain any single routing decision with `yarn check:intent "<what you said>"` |
| `page_awaitMonitor` returns `settled: false` | The poll window passed while the watch continues. Call again — the monitor is still running in the browser |
| A theme change vanished | Themes do not survive a reload or a navigation. Reapply it |
| A site map was written but nothing changed | Maps stage for review. Open **Skills** in the panel and press **Activate** |
| The panel switched conversations on its own | The panel follows the tab in front, and each tab has its own conversation |
| A recording's typed values came back as `{{placeholders}}` | That is the default. Tick **Save what I type** to keep literal values |

---

## Useful commands

```sh
browsentic status      # daemon, extension and agent state
browsentic agent       # which agents are installed, and which one runs the side panel
browsentic sessions    # which browsers are paired
browsentic revoke      # unpair everything, or one origin
browsentic skills      # every skill in scope, and where it came from
browsentic approvals   # the "always on this site" grants
browsentic tools       # the tool manifest, no browser needed
browsentic logs        # run starts, routed skills, every tool call
browsentic token       # the control token, for MCP clients
browsentic restart     # swap the running daemon for a fresh one
browsentic stop
```

Full descriptions in [reference/cli.md](../reference/cli.md).

---

## Still stuck

- [Limits](limits.md) — it may be a boundary rather than a bug
- [reference/errors.md](../reference/errors.md) — every code, with what it implies about the next move
- [internals/](../internals/) — how the piece that is failing actually works
