# Troubleshooting

Symptom, cause, fix. For what an error *code* means, see [reference/errors.md](../reference/errors.md).

---

## Start here

```sh
browsentic status      # the Bridge, each paired browser and its store, the agent
browsentic agent       # which agents are installed, which one runs the side panel
browsentic logs        # run starts, routed skills, every tool call and its outcome
```

Those three answer most questions. Browsentic Bridge's log also lives at `~/.browsentic/daemon.log`.

---

## Setup and connection

| Symptom | Cause | Fix |
| --- | --- | --- |
| The popup says `protocol version mismatch: daemon speaks v20` (any number below 22) | Browsentic Bridge is older than the extension: anything before 0.7.14 | Update the Bridge: **Update now** in the app, or `npx browsentic@latest update`. Then enter a new pairing code in the popup, because this version of the extension waits for one after a refusal |
| The popup says `protocol version mismatch: Browsentic Bridge speaks v22 and takes extensions from v22 on` | The extension is older than 0.7.14: an unpacked copy nobody updated | Remove it and add Browsentic from the store, or `browsentic update` and press ↻ on its card |
| The store copy is a version behind the Bridge | The browser has not checked for updates yet | Nothing breaks meanwhile: the two work across versions. **Update** at `chrome://extensions`, with Developer mode on, checks now |
| `browsentic status` says two copies of Browsentic answer in one browser | An unpacked copy and a store copy are both installed, and both inject into every page | Remove the unpacked card at the browser's extensions page |
| Edge will not install from the Chrome Web Store | Edge installs from other stores only once you allow it | Get it from [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/browsentic/cbkjhkgjcpihokphhdkbahilpcjojpdc) instead, or press **Allow extensions from other stores** in the bar at the top of the store page, confirm, then **Add to Chrome** |
| `browsentic setup` keeps waiting for the browser | The extension is in, but not paired yet | Click Browsentic in the toolbar and enter the code `setup` printed. Ctrl-C stops the wait without undoing anything |
| Popup shows `Expected {op:…}` | Stale service worker after a rebuild | `chrome://extensions` → ↻ reload Browsentic |
| "That pairing code is wrong or expired" | Codes are single-use and last 10 minutes | `browsentic pair` for a fresh one. A failed attempt does not burn the outstanding code |
| "No Browsentic daemon is running" | Browsentic Bridge is not installed, or not running on 8765–8767 | Install it ([Install](install.md#1-install-browsentic)), or open the app, or `browsentic start`. Then `browsentic status`; check `browsentic logs` |
| `browsentic: command not found` | The global npm prefix is not on `PATH` | `npm prefix -g`, then add its `bin` directory |
| "Browsentic has not been given the microphone yet" | A browser cannot show its microphone prompt inside a side panel or a popup, so a fresh install has never been asked | Press **Allow microphone** and choose **Allow** in the tab that opens |
| "Microphone access is blocked" | The microphone was refused for the extension | Press **Allow microphone**, then click the icon at the left of that tab's address bar and set **Microphone** to **Allow** |
| "This browser has no speech service" | Brave and some Chromium builds ship speech recognition without a transcription service behind it | Type instead, or use Chrome or Edge for dictation |
| No detach button in the panel's header, and no `/hands-free` | Hands-free is offered only where speech can be transcribed — never in Firefox or Brave, and not in a browser whose speech service has failed before it ever worked | Use Chrome or Edge. If the service was only out of reach, dictate in the panel once: the first word it transcribes brings the button back |
| "Hands-free is not available here", and the mic left the page | The speech service failed before it had ever transcribed a word in this browser | As above. Open Browsentic from the toolbar to carry on by typing |
| The hands-free mic says speech recognition stopped | The recognizer stopped for a reason other than a missing service — a language the service does not take, a moment offline, or the page it listens from could not start | Press the mic to try again. Unlike "no speech service", this never hides hands-free |
| The hands-free mic turns amber and says another page took the microphone | Chrome runs one speech recognizer at a time, and another page or the panel started one | Press the mic to take it back |
| Holding Control does nothing | Hold to talk is off; the key went to a frame embedded in the page (some editors); another key or a click joined it; or the mic is muted | Turn **Hold to talk** on from the mic's menu, click the page outside the embedded editor, and hold left Control on its own |
| `EXTENSION_OFFLINE` | Browser closed, or not paired | Open the browser; `browsentic sessions` to check pairing |
| After a reboot the panel stays offline until you run a command | The browser has no helper registered to start the Bridge, or one a Bridge before 0.8 registered, which lets in only the unpacked copy | Run `browsentic setup` once, or start Browsentic Bridge 0.8 once, which rewrites the registration. `browsentic status` then lists the browsers under `wake-up:` |
| The panel stays offline after `browsentic stop` | A stop holds the browser's wake-up, so the daemon stays down as asked | `browsentic start`. `browsentic status` says `held` while it lasts |
| A scheduled task shows **Missed** | The browser was closed, the computer asleep, or no daemon was running at that time | Nothing to fix — it runs once when things are back unless the task says **Skip it**. `browsentic status` shows whether the browser can start the daemon itself |
| "Load unpacked" cannot see `~/browsentic` | A Flatpak or Snap browser, sandboxed away from your home directory. Snap Chromium is the Ubuntu default | Add Browsentic from the Chrome Web Store instead, which needs no folder. Or grant it: `flatpak override --user --filesystem=~/browsentic com.google.Chrome`, or install somewhere the sandbox can read: `browsentic setup --unpacked --dir ~/snap/chromium/common/browsentic-extension` |
| The folder picker does not show `~/browsentic` | It is there; some pickers open elsewhere by default | macOS: press ⇧⌘G and paste the path. Linux: Ctrl+L. Windows: paste `%USERPROFILE%\browsentic\extension\chrome-mv3` into the picker's address bar |
| Updated, but an unpacked copy still runs the old build | A browser never reloads an unpacked extension by itself | `browsentic status` names both versions. Press ↻ on the Browsentic card. A store copy updates itself |
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
| `tools: the extension's own list` | The extension and Browsentic Bridge are different versions, so their tool lists differ | Normal while one of them waits on an update; the tools come from the extension, which runs them. From a clone: `yarn build && yarn daemon:restart`, then reload the extension |

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
| Antigravity: a follow-up turn searches the web, or ends with no answer, instead of reading the page | An older Browsentic gave each turn its own folder, and Antigravity re-reads the first turn's, so later turns carried a run id that had ended | Update Browsentic, then start a new conversation — one begun before the update stays broken |
| Codex fails with "not logged in" | The daemon inherits no session | `codex login`, then retry |
| Codex answers about the page without opening it, or from a web search | Codex defers an MCP server's tools until the model searches for them, so a web search is the tool it can see; an older Browsentic also failed to switch that search off | Update Browsentic; the run now says where its browser tools are and switches web search off |
| Codex sees only part of a long page | Codex cuts a tool result over 25,000 tokens; an older Browsentic left its 10,000 default in place | Update Browsentic, then ask for less at a time: a smaller `maxPerKind`, or `page_extractText` group by group |
| Codex in the side panel ignores an MCP server from your `config.toml` | By design: its MCP servers would start beside the browser with no approval gate, so each is switched off for the run | Nothing to do; the browser tools are the run's |
| Codex ignores a profile or custom model provider, and replies arrive whole | It is running through `codex exec` — set `"transport": "exec"`, or its app-server was refused (the daemon log says so), and exec leaves `config.toml` out | Update Codex, then `browsentic restart`; the `model` and `model_reasoning_effort` at the top of `config.toml` still apply |
| Claude Code or Codex stops with *could not start Browsentic's browser tools* | The browser tools the run was given did not start — often a daemon still running from files an update replaced | `browsentic restart`, then send the message again |
| A follow-up on Claude Code or Codex ignores a pick, an attached skill or new site notes | Both keep the prompt a conversation began with, and an older Browsentic changed only that prompt | Update Browsentic; each message now carries what changed |
| Mistral Vibe: every action on a follow-up turn fails with `RUN_INACTIVE` | Vibe re-reads a resumed session from the folder it began in, and an older Browsentic wrote each turn to a folder of its own | Update Browsentic, then start a new conversation: one begun before the update keeps its first folder |
| Grok Build sits silent for minutes, then fails with *xAI did not answer* | The Grok account is rate-limited, as a free one is; Grok retries quietly before giving up | Wait, or upgrade the account |
| Cursor CLI fails with *Authentication required* | The daemon inherits no session | `cursor-agent login`, or set `CURSOR_API_KEY` |
| Cursor CLI answers without ever touching the page, or searches and greps until *Agent Looping Detected* | The run's MCP server was never approved, so Cursor gave the model no browser tools; an older Browsentic did not approve it | Update Browsentic: each turn now approves its own server with `cursor-agent mcp enable browsentic` |
| Cursor CLI fails with *could not be set up for this turn* | `cursor-agent mcp enable browsentic` failed in the run's folder | Run `cursor-agent update`; the message carries what Cursor printed |
| Cursor CLI asks for the same approval again after a minute | Cursor abandons a tool call at 60 s, so an unanswered approval is handed back and the agent calls again under the same card | Nothing to do — answer the card when you are ready |
| Cursor CLI reaches an MCP server you did not expect | A project `.cursor/mcp.json` does not replace your global one, so every server you gave Cursor loads too, as does every plugin's | Browsentic denies each by name for the run, and plugin servers as one; if one still answers, the run is stopped (`AGENT_UNSAFE`) — update Browsentic and report it |
| Cursor CLI is less fenced off on Windows | Cursor's kernel sandbox has no Windows backend | Nothing to do — the deny rules still apply; treat a Windows run as `host`-class |
| Windows: `AGENT_UNUSABLE`, *a batch file Browsentic cannot see through* | The agent's command is a batch file that is not an npm or pnpm shim, and Browsentic never runs one through `cmd.exe` | Set `agents.<name>.bin` to the `.exe` it runs |
| Windows: *This turn is too long for Windows to start* | Codex's `exec` fallback, Qwen Code and Grok Build pass the prompt as an argument, and Windows caps a command line at 32,767 characters | Start a new conversation, or leave out long site notes, attached files or fetched data. Claude Code is not affected |
| Windows: *Windows protected your PC* when opening the installer | The installer is not code-signed yet, and SmartScreen checks every file a browser downloaded | Press **More info → Run anyway**, or install with `irm https://browsentic.com/install.ps1 \| iex`, which leaves no download mark |
| Windows: `browsentic` is not recognized, though the app put it on the `PATH` | The terminal was open before; it keeps the `PATH` it started with | Open a new terminal |
| Windows: the app says another `browsentic` is on your `PATH` | An `npm install --global browsentic` comes first, and would run an older copy than the app's | `npm rm -g browsentic` |
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
| `TAB_UNREACHABLE` on a normal site | The extension needs reloading | Turn Browsentic off and on at `chrome://extensions` (↻ on an unpacked copy); ordinary sites otherwise self-heal |
| `TAB_UNREACHABLE` on `chrome://`, the Web Store, the new-tab page | Those pages cannot host a content script | `page_navigate` to an http(s) page — it still works there |
| `TARGET_NOT_FOUND` for something clearly on screen | The page changed since the snapshot, or it is inside a captcha widget's shadow root | Re-snapshot with `page_getPageInfo`; for a captcha use [`page_solveCaptcha`](features/captcha.md) |
| A captcha keeps setting new image challenges | The vendor distrusts the browser, however well each round is answered — common with automated or headless browsers | Solve one round yourself in the page; a person's answer usually clears the distrust. See [Captchas](features/captcha.md#image-challenges) |
| `DEBUGGER_UNAVAILABLE` | DevTools is open on that tab | Close DevTools, or use `page_clickElement` instead of `page_trustedClick` |
| `RUN_IN_PROGRESS` | One instruction at a time per tab | Cancel the running one, or use another tab |
| `TAB_IN_USE` | That tab belongs to another Browsentic conversation | Switch to it from the Sessions strip |
| A tool set to run on every visit never runs | Chrome keeps user scripts off until you allow them for the extension | `chrome://extensions` → Browsentic → **Details** → **Allow User Scripts**. See [Running one on every visit](features/page-actions.md#running-one-on-every-visit) |
| A tool set to run on every visit ran but changed nothing | It ran before the site had drawn what it changes, or the site changed its markup | The page's console has a `Browsentic:` line if it threw. Run it with `/` to check it still works, and make a new one with the Live tool switch if it does not |

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

- **Report a bug** on the About page — the extension's settings page, or the About tab of the Mac or Windows app — opens GitHub's issue form with your versions already filled in
- [Limits](limits.md) — it may be a boundary rather than a bug
- [reference/errors.md](../reference/errors.md) — every code, with what it implies about the next move
- [internals/](../internals/) — how the piece that is failing actually works
