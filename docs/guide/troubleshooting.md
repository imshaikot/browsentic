# Troubleshooting

Causes and fixes for common problems with setup, pairing, agent CLIs, page tools and the optional
MCP endpoint, listed by the symptom or message you see. For what an error *code* means, see
[reference/errors.md](../reference/errors.md).

---

## Start here

```sh
browsentic status      # the Bridge, each paired browser and its store, the agent
browsentic agent       # which agents are installed, which one runs the side panel
browsentic logs        # run starts, routed skills, every tool call and its outcome
```

Those three answer most questions. The Bridge's log is at `~/.browsentic/daemon.log`.

---

## Setup and connection

| Symptom | Cause | Fix |
| --- | --- | --- |
| The popup says `protocol version mismatch: daemon speaks v20` (any number below 22) | Browsentic Bridge is older than 0.7.14, too old for this extension | Update the Bridge (**Update now** in the app, or `npx browsentic@latest update`), then enter a new pairing code in the popup: after a refusal, this version of the extension waits for one |
| The popup says `protocol version mismatch: Browsentic Bridge speaks v22 and takes extensions from v22 on` | The extension is older than 0.7.14, usually an unpacked copy that was never updated | Remove it and install the extension from its store, or run `browsentic update` and press ↻ on its card |
| The store copy is a version behind the Bridge | The browser has not checked for updates yet | Nothing breaks meanwhile, because the two work across versions. To update now, turn on Developer mode at `chrome://extensions` and press **Update** |
| `browsentic status` says two copies of Browsentic answer in one browser | An unpacked copy and a store copy are both installed, and both inject into every page | Remove the unpacked copy on the browser's extensions page |
| Edge will not install from the Chrome Web Store | Edge blocks other stores until you allow them | Install from [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/browsentic/cbkjhkgjcpihokphhdkbahilpcjojpdc) instead. Or press **Allow extensions from other stores** in the bar at the top of the store page, confirm, then press **Add to Chrome** |
| `browsentic setup` keeps waiting for the browser | The extension is installed but not paired yet | Click Browsentic in the toolbar and enter the code `setup` printed. Ctrl-C stops the wait without undoing anything |
| Popup shows `Expected {op:…}` | Stale service worker after a rebuild | At `chrome://extensions`, press ↻ on Browsentic |
| "That pairing code is wrong or expired" | Codes are single-use and last 10 minutes | Run `browsentic pair` for a new code. A failed attempt does not use up the outstanding code |
| "No Browsentic daemon is running" | Browsentic Bridge is not installed, or not running on 8765–8767 | [Install it](install.md#1-install-browsentic), open the app, or run `browsentic start`. Then check `browsentic status` and `browsentic logs` |
| `browsentic: command not found` | The global npm prefix is not on `PATH` | Run `npm prefix -g` and add its `bin` directory to your `PATH` |
| "Browsentic has not been given the microphone yet" | Browsers cannot show the microphone prompt inside a side panel or a popup, so a fresh install has never asked | Press **Allow microphone** and choose **Allow** in the tab that opens |
| "Microphone access is blocked" | Microphone permission was refused for the extension | Press **Allow microphone**, then click the icon at the left of that tab's address bar and set **Microphone** to **Allow** |
| "This browser has no speech service" | Brave and some Chromium builds ship speech recognition without a transcription service behind it | Type instead, or use Chrome or Edge for dictation |
| No detach button in the panel's header, and no `/hands-free` | Hands-free is offered only where speech can be transcribed: never in Firefox or Brave, and not in a browser whose speech service failed before it ever worked | Use Chrome or Edge. If the service was only out of reach, dictate in the panel once: the first word it transcribes brings the button back |
| "Hands-free is not available here", and the mic left the page | The speech service failed before it had ever transcribed a word in this browser | As above. Open Browsentic from the toolbar to continue by typing |
| The hands-free mic says speech recognition stopped | The recognizer stopped for a reason other than a missing service: a language the service does not take, a moment offline, or the page it listens from could not start | Press the mic to try again. Unlike "no speech service", this never hides hands-free |
| The hands-free mic turns amber and says another page took the microphone | Chrome runs one speech recognizer at a time, and another page or the panel started one | Press the mic to take it back |
| Holding Control does nothing | Hold to talk is off; the key went to a frame embedded in the page (some editors); another key or a click joined it; or the mic is muted | Turn on **Hold to talk** in the mic's menu, click the page outside any embedded editor, and hold left Control on its own |
| `EXTENSION_OFFLINE` | The browser is closed, or not paired | Open the browser, then run `browsentic sessions` to check pairing |
| After a reboot the panel stays offline until you run a command | The browser has no native messaging host registered to start the Bridge, or has one registered by a Bridge older than 0.8, which lets in only the unpacked copy | Run `browsentic setup` once, or start Browsentic Bridge 0.8 once; either rewrites the registration. `browsentic status` then lists the browsers under `wake-up:` |
| The panel stays offline after `browsentic stop` | `stop` also holds the browser's wake-up, so the Bridge stays down as asked | Run `browsentic start`. Until then, `browsentic status` shows `held` |
| A scheduled task shows **Missed** | The browser was closed, the computer was asleep, or no Bridge was running at that time | Nothing to fix: the task runs once when they are back, unless it is set to **Skip it**. `browsentic status` shows whether the browser can start the Bridge itself |
| "Load unpacked" cannot see `~/browsentic` | The browser is a Flatpak or Snap, sandboxed away from your home directory (Snap Chromium is the Ubuntu default) | Install the extension from the Chrome Web Store instead, which needs no folder. Or grant access: `flatpak override --user --filesystem=~/browsentic com.google.Chrome`. Or install where the sandbox can read: `browsentic setup --unpacked --dir ~/snap/chromium/common/browsentic-extension` |
| The folder picker does not show `~/browsentic` | The folder exists; some pickers open elsewhere by default | macOS: press ⇧⌘G and paste the path. Linux: press Ctrl+L. Windows: paste `%USERPROFILE%\browsentic\extension\chrome-mv3` into the picker's address bar |
| Updated, but an unpacked copy still runs the old build | A browser never reloads an unpacked extension by itself | Press ↻ on the Browsentic card; `browsentic status` shows both versions. A store copy updates itself |
| `browsentic update` says "already current" forever, and reinstalling still lands on an old build | npm's `npx` cache serves the version it first resolved and never asks the registry again | Run `browsentic update`, which now replaces the cached command before installing. To clear the cache by hand, delete every `~/.npm/_npx/*` directory containing `node_modules/browsentic` |
| Deleted `~/.browsentic`, but a daemon is still holding port 8765 | The lockfile was deleted, but the process did not notice | Run `browsentic stop`: it probes the ports rather than reading the lockfile, so it finds the process. `browsentic uninstall` does the same as part of its sweep |

## Agents

| Symptom | Cause | Fix |
| --- | --- | --- |
| `AGENT_MISSING` | The chosen CLI is not on the *Bridge's* `PATH` | Run `browsentic agent` to see every agent, and set `agents.<name>.bin` to an absolute path in `config.json` |
| `AGENT_NEEDS_PERMISSION` | Antigravity has no rule allowing Browsentic's page tools | Press the button in the popup, or run `browsentic agent fix antigravity` |
| `AGENT_NEEDS_PERMISSION` for Grok Build | Grok Build is not signed in | Run `grok login`, or set `XAI_API_KEY` |
| "does not understand the flags Browsentic uses" | The agent CLI is too old | Update the CLI |
| The model select says *built-in list*, with a reason | Browsentic could not read that CLI's own model list, usually because the CLI is signed out | Sign the CLI in, then press **Recheck**. `browsentic agent models <name> --refresh` shows the full reason |
| Mistral Vibe fails with *has no API key* | Vibe was never set up, or its key lives only in a shell the Bridge was not started from | Run `vibe --setup`, which stores the key in `~/.vibe/.env` |
| Antigravity answers but never touches the page | Its permission rule was removed | Run `browsentic agent`, which reports *needs setup* again, then restore the rule with `browsentic agent fix antigravity` |
| Antigravity: a follow-up turn searches the web, or ends with no answer, instead of reading the page | An older Browsentic gave each turn its own folder, and Antigravity re-reads the first turn's, so later turns carried a run id that had ended | Update Browsentic, then start a new conversation; one begun before the update stays broken |
| Codex fails with "not logged in" | The Bridge inherits no session | Run `codex login`, then retry |
| Codex answers about the page without opening it, or from a web search | Codex defers an MCP server's tools until the model searches for them, so web search is the tool it can see; an older Browsentic also failed to switch that search off | Update Browsentic. A run now tells Codex where its browser tools are and switches web search off |
| Codex sees only part of a long page | Codex cuts a tool result over 25,000 tokens; an older Browsentic left its 10,000 default in place | Update Browsentic, then read less at a time: a smaller `maxPerKind`, or `page_extractText` one group at a time |
| Codex in the side panel ignores an MCP server from your `config.toml` | By design: its MCP servers would start beside the browser with no approval gate, so each is switched off for the run | Nothing to fix; a run uses only the browser tools |
| Codex ignores a profile or custom model provider, and replies arrive whole | It is running through `codex exec`, either because `"transport": "exec"` is set or because its app-server was refused (the daemon log says so), and exec leaves `config.toml` out | Update Codex, then run `browsentic restart`. The `model` and `model_reasoning_effort` at the top of `config.toml` still apply |
| Claude Code or Codex stops with *could not start Browsentic's browser tools* | The run's browser tools did not start, often because a Bridge is still running from files an update replaced | Run `browsentic restart`, then send the message again |
| A follow-up on Claude Code or Codex ignores a pick, an attached skill or new site notes | Both keep the prompt a conversation began with, and an older Browsentic changed only that prompt | Update Browsentic. Each message now carries what changed |
| Mistral Vibe: every action on a follow-up turn fails with `RUN_INACTIVE` | Vibe re-reads a resumed session from the folder it began in, and an older Browsentic wrote each turn to a folder of its own | Update Browsentic, then start a new conversation; one begun before the update keeps its first folder |
| Grok Build sits silent for minutes, then fails with *xAI did not answer* | The Grok account is rate-limited, as a free one is, and Grok retries quietly before giving up | Wait, or upgrade the account |
| Cursor CLI fails with *Authentication required* | The Bridge inherits no session | Run `cursor-agent login`, or set `CURSOR_API_KEY` |
| Cursor CLI answers without ever touching the page, or searches and greps until *Agent Looping Detected* | The run's MCP server was never approved, so Cursor gave the model no browser tools; an older Browsentic did not approve it | Update Browsentic. Each turn now approves its own server with `cursor-agent mcp enable browsentic` |
| Cursor CLI fails with *could not be set up for this turn* | `cursor-agent mcp enable browsentic` failed in the run's folder | Run `cursor-agent update`. The error includes what Cursor printed |
| Cursor CLI asks for the same approval again after a minute | Cursor abandons a tool call at 60 s, so an unanswered approval is handed back and the agent calls again under the same card | Nothing to fix: answer the card when you are ready |
| Cursor CLI reaches an MCP server you did not expect | A project `.cursor/mcp.json` does not replace your global one, so every server you gave Cursor loads too, as does every plugin's | Update Browsentic and report it. Browsentic denies each server by name for the run, and all plugin servers as one; if one still answers, the run is stopped (`AGENT_UNSAFE`) |
| Cursor CLI is less fenced off on Windows | Cursor's kernel sandbox has no Windows backend | Nothing to fix: the deny rules still apply. Treat a Windows run as `host`-class |
| Windows: `AGENT_UNUSABLE`, *a batch file Browsentic cannot see through* | The agent's command is a batch file that is not an npm or pnpm shim, and Browsentic never runs one through `cmd.exe` | Set `agents.<name>.bin` to the `.exe` it runs |
| Windows: *This turn is too long for Windows to start* | Codex's `exec` fallback, Qwen Code and Grok Build pass the prompt as an argument, and Windows caps a command line at 32,767 characters | Start a new conversation, or leave out long site notes, attached files or fetched data. Claude Code is not affected |
| Windows: *Windows protected your PC* when opening the installer | The installer is not code-signed yet, and SmartScreen checks every file a browser downloaded | Press **More info → Run anyway**, or install with `irm https://browsentic.com/install.ps1 \| iex`, which leaves no download mark |
| Windows: `browsentic` is not recognized, though the app put it on the `PATH` | The terminal was already open and keeps the `PATH` it started with | Open a new terminal |
| Windows: the app says another `browsentic` is on your `PATH` | An `npm install --global browsentic` comes first on the `PATH` and would run an older copy than the app's | Run `npm rm -g browsentic` |
| `AGENT_UNSAFE`: *Grok Build offered this run …* | Grok offered tools Browsentic never asks for, so the run was stopped before the model saw them | Update Grok Build and Browsentic, and report it if it persists |
| Qwen Code fails with *No auth type is selected* | Qwen has no provider configured, and its OAuth free tier ended on 2026-04-15 | Run `qwen` and use `/auth`, or export `OPENAI_API_KEY` with `OPENAI_BASE_URL` |
| Qwen Code cannot see an API key you exported | Only `QWEN_*`, `DASHSCOPE_*`, `BAILIAN_*` and `OPENAI_*` reach a run; the rest are sealed away | Point Qwen at one of those four providers |
| `AGENT_UNSAFE`: *Qwen Code registered …* / *loaded the MCP server …* | Qwen's own startup line named a tool or a server Browsentic denied, so the run was stopped before the model saw it | Update Qwen Code and Browsentic, and report it if it persists |
| OpenCode fails with *free models refuse a run whose tools Browsentic has narrowed to the browser* | OpenCode Zen's free tier serves only requests carrying OpenCode's own built-in tools | Run `opencode auth login`, then pick that provider's model in the popup |
| OpenCode fails with *could not start this turn* | Usually a model OpenCode does not know | Pick a model exactly as `opencode models` lists it, `provider/model` |
| OpenCode cannot see an API key you exported | Only `OPENCODE_*` reaches a run; the rest are sealed away | Run `opencode auth login`, which keeps the key in OpenCode's own file |
| `AGENT_UNSAFE`: *OpenCode ran its own … tool* | A tool outside the browser ran despite the run's rules, so the run was stopped | Update OpenCode and Browsentic, and report it |

## Pages and tabs

| Symptom | Cause | Fix |
| --- | --- | --- |
| `TAB_UNREACHABLE` on a normal site | The extension needs reloading | Turn Browsentic off and on at `chrome://extensions` (press ↻ on an unpacked copy). Ordinary sites otherwise recover by themselves |
| `TAB_UNREACHABLE` on `chrome://`, the Web Store, the new-tab page | Those pages cannot host a content script | Go to an http(s) page with `page_navigate`, which still works on these pages |
| `TARGET_NOT_FOUND` for something clearly on screen | The page changed since the snapshot, or the element is inside a captcha widget's shadow root | Take a new snapshot with `page_getPageInfo`. For a captcha, use [`page_solveCaptcha`](features/captcha.md) |
| A captcha keeps setting new image challenges | The vendor distrusts the browser, however well each round is answered; this is common with automated or headless browsers | Solve one round yourself in the page; a person's answer usually clears the distrust. See [Captchas](features/captcha.md#image-challenges) |
| `DEBUGGER_UNAVAILABLE` | DevTools is open on that tab | Close DevTools, or use `page_clickElement` instead of `page_trustedClick` |
| `RUN_IN_PROGRESS` | A tab runs one instruction at a time | Cancel the running one, or use another tab |
| `TAB_IN_USE` | That tab belongs to another Browsentic conversation | Switch to that conversation from the Sessions strip |
| A tool set to run on every visit never runs | Chrome keeps user scripts off until you allow them for the extension | Open `chrome://extensions` → Browsentic → **Details** and turn on **Allow User Scripts**. See [Running one on every visit](features/page-actions.md#running-one-on-every-visit) |
| A tool set to run on every visit ran but changed nothing | It ran before the site had drawn what it changes, or the site changed its markup | Check the page's console for a `Browsentic:` line, which appears if it threw. Run the tool with `/` to check it still works; if it does not, make a new one with the Live tool switch |

## Android phones

`browsentic android`, or the **Android** tab in the Mac and Windows apps, runs every check below and
names the one that fails. See [Android phone](features/android.md) for setting a phone up.

| Symptom | Cause | Fix |
| --- | --- | --- |
| No Android switch in the side panel | The Bridge sees no phone, the Bridge predates Android, or the browser is Firefox | Run `browsentic android`. Update the Bridge if it does not know the command. Firefox has no Android switch |
| `ANDROID_OFF` | `"android": { "enabled": false }` is set in `config.json` | Set it to `true`, or remove it |
| `ADB_MISSING` | adb, from Android's platform-tools, is not installed, or not where the Bridge looks | Install platform-tools (the check prints the command for your system), or name your adb with `"android": { "adb": "/path/to/adb" }` |
| `ADB_BROKEN` | The adb the Bridge found does not run | Reinstall platform-tools, or name a working adb in `config.json` |
| `NO_DEVICE` | No phone is connected, USB debugging is off, or the cable only charges | Turn on USB debugging and connect with a data cable. On Windows, see the next row |
| adb sees nothing on Windows | Many phones need their maker's USB driver, or Google's, before Windows lets adb see them | Install the driver from Android's [OEM USB drivers](https://developer.android.com/studio/run/oem-usb) page, then plug the phone in again |
| `DEVICE_UNAUTHORIZED` | The phone has not allowed this computer | Unlock the phone and tap **Allow** on the USB debugging prompt. If no prompt shows, unplug it and plug it in again |
| `DEVICE_OFFLINE` | The phone is connected but not answering adb, or it is in recovery or bootloader mode | Unplug it and plug it in again; over Wi-Fi, run `adb connect <ip:port>` again. A phone in another mode needs a normal restart |
| `DEVICE_BOOTING` | The phone is still starting up | Wait for it to finish |
| `NO_PERMISSIONS` (Linux) | The system does not let your user open the phone's USB connection | Install udev rules for Android phones (`sudo apt install android-sdk-platform-tools-common` on Debian and Ubuntu), then plug the phone in again |
| `CHROME_MISSING` | Google Chrome is not installed on the phone | Install it from the Play Store. The Android tab's **Get Chrome** opens its page on the phone |
| `CHROME_NOT_RUNNING` | Chrome is not open on the phone | Open it, or run `browsentic android open`. The phone tab and the Android tab have a button that does the same |
| `SCREEN_OFF` | The phone's screen is off, so Chrome is not drawing | Unlock the phone. Keep it awake while the agent works |
| The phone tab's picture is black or frozen | The phone's screen went off, or the phone tab was hidden, which pauses the picture | Wake the phone, and bring the phone tab to the front |
| Taps land in the wrong place | The page moved between finding the element and tapping it, or the phone's keyboard or a banner covers it | Ask again once the page has settled. The agent finds the element again before every tap |
| `NOT_ON_PHONE` | The tool works only in desktop tabs | Do that step in a desktop tab |
| `PHONE_GONE` | The phone session ended: the phone was unplugged, Chrome closed on it, or Android was switched off | Press **Reconnect** in the phone tab, or switch Android on again |
| `PHONE_PAGE_UNREACHABLE` | The page on the phone was still loading or kept navigating | Wait for it to load and try again |

## MCP clients

These apply only when another tool drives Browsentic through its optional MCP endpoint.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tools missing from a session | The server was registered mid-session | Restart the client session: MCP servers load when it starts |
| A tool call is refused as needing approval | External callers cannot answer a prompt, so `confirm` becomes deny | Do it from the side panel, or set `guardrails.unattended: "allow"` ([read this first](approvals.md#callers-with-nobody-to-ask)) |
| `page_extractText` with `format: "html"` is denied | `raw-html-read` is denied by default | Use the default text format, or allow it with `{"guardrails":{"rules":{"raw-html-read":"allow"}}}` |
| `page_readNetwork` with `includeBodies` is denied | `network-body-read` is denied by default | Read status, timing and `includeHeaders` instead, or allow it with `{"guardrails":{"rules":{"network-body-read":"allow"}}}` |
| `page_readConsole` comes back empty | Nothing was attached when the error happened | Call `page_startDiagnostics` **first**, then reproduce the error. Pass `reload: true` to catch load-time errors |
| `DEBUGGER_UNAVAILABLE` on `page_startDiagnostics` | DevTools is open on that tab, and Chrome allows one debugger per tab | Close DevTools and retry |
| `tools: the extension's own list` | The extension and Browsentic Bridge are different versions, so their tool lists differ | Nothing to fix while one of them waits for an update: the tools come from the extension, which runs them. From a clone, run `yarn build && yarn daemon:restart`, then reload the extension |

## Behaviour that looks wrong but is not

| Symptom | Why |
| --- | --- |
| An action ran but nothing appears in `logs` | It matched the local intent grammar and never reached the Bridge; such actions carry a ⚡ on the timeline. `yarn check:intent "<what you said>"` explains any single routing decision |
| `page_awaitMonitor` returns `settled: false` | The poll window ended while the watch continues. Call again; the monitor is still running in the browser |
| A theme change vanished | Themes do not survive a reload or a navigation. Reapply it |
| A site map was written but nothing changed | Maps are staged for review. Open **Skills** in the panel and press **Activate** |
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

Full descriptions are in [reference/cli.md](../reference/cli.md).

---

## Still stuck

- **Report a bug** on the About page (in the extension's settings page, or the About tab of the Mac or Windows app) opens GitHub's issue form with your versions filled in
- [Limits](limits.md): it may be a known limit rather than a bug
- [reference/errors.md](../reference/errors.md): every error code, and what it means for your next step
- [internals/](../internals/): how each component works
