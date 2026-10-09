# Error codes

Every error code Browsentic returns, where it comes from, and what to do next.

Errors are `{ ok: false, error: { code, message } }` at every layer. The agent receives one as a
tool result marked `isError`, with the text `CODE: message`. A failed tool call never crashes a
run, and the message carries the *fix*. In the **Origin** column, Daemon is Browsentic Bridge.

---

## Connection

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `EXTENSION_OFFLINE` | Daemon | No live browser link. Open the browser, or pair. **Retrying will not help** |
| `DAEMON_UNREACHABLE` | RemoteBridge | The daemon died mid-call |

## Targeting a page

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `TAB_UNREACHABLE` | Extension | The page refuses content scripts, or one was just injected. Navigate to an http(s) page, or re-snapshot |
| `NO_ACTIVE_TAB` | Extension | No focused tab in the current window |
| `TARGET_NOT_FOUND` | Content script | Nothing matched; the page changed. Take a fresh snapshot |
| `INVALID_TARGET` | Content script | A target with neither `selector` nor `text`. `role`/`nth` only narrow |
| `DEBUGGER_UNAVAILABLE` | Extension | Chrome's debugger could not attach, usually because DevTools is open on that tab. Close it, or use `page_clickElement` instead of `page_trustedClick` |
| `CAPTCHA_NOT_FOUND` | Extension | No known captcha widget, so whatever is blocking the run is something else |

## Input and dispatch

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `INVALID_INPUT` | Dispatch | The input failed schema validation (zod); the message names the field |
| `UNSUPPORTED` | Action | The action cannot do what was asked, e.g. open a non-http(s) URL |
| `TIMEOUT` | Link or action | A wait expired, or the extension did not answer in the window for that action |
| `ACTION_FAILED` | Action | `execute()` threw, e.g. `back` with no history |
| `PICK_CANCELLED` | Content script | The user dismissed A-Eye without pointing at anything, or a newer pick took over the lens. **Terminal**: ask in words rather than asking them to point again |
| `NO_FOCUS_SHOT` | Daemon | `browsentic_focusShot` was called on a run whose instruction carried no A-Eye pick, so there is no picture to show |
| `UNKNOWN_ACTION` | Registry / daemon | Tool-registry skew, or a reserved action reached from outside |

## Diagnostics

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `DIAGNOSTICS_NOT_FOUND` | Extension | Nothing is recording, or that `diagnosticsId` is unknown. Console and network events exist only while attached: call `page_startDiagnostics` **before** reproducing the problem |
| `DIAGNOSTICS_IN_PROGRESS` | Extension | That tab is already being recorded. Read it, or stop it first |
| `DIAGNOSTICS_LIMIT` | Extension | Two tabs are already being recorded. Stop one |
| `DEBUGGER_UNAVAILABLE` | Extension | Chrome refused the attach, usually because DevTools is open on that tab. Close it and retry |
| `UNSUPPORTED` | Extension | A debugger-only tool was called on Firefox. A Firefox build leaves those nine off its list, so only a stale skill or recording reaches this. There is no fallback |
| `BLOCKED` | Policy | `includeBodies: true` without the `network-body-read` rule allowed. Metadata and headers are still available |

## Runs and sessions

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `RUN_IN_PROGRESS` | AgentSession | One instruction at a time **per tab session**; other sessions are unaffected |
| `RUN_LIMIT` | AgentSession | Too many sessions running at once (`maxConcurrentRuns`: default 3, ceiling 8) |
| `SESSION_LIMIT` | Extension | Eight tab sessions are already open |
| `SESSION_TAB_CLOSED` | Extension | Every tab this conversation was working in has been closed |
| `TAB_IN_USE` | Extension | That tab belongs to another Browsentic conversation |
| `RUN_INACTIVE` | AgentSession | The run was cancelled while a tool call was in flight |
| `APPROVAL_TIMEOUT` | AgentSession | A scheduled run asked for approval and nobody answered within ten minutes, so the action was declined. The agent is told to stop and say what it was about to do |
| `APPROVAL_PENDING` | AgentSession | The user has not answered an approval yet, and the agent's CLI would abandon the call before they do (Cursor CLI, at 60 s). The request stays on screen: make the **same call again, with the same input**, to keep waiting. Any other call withdraws it |
| `RESULT_TOO_LARGE` | MCP server | The call went through, but its result is longer than the agent's CLI passes to its model (Cursor CLI: 40,000 bytes). Do not repeat an action for its result; ask for less: `page_extractText` with a smaller `maxLength` and its cursor, `page_getPageInfo` with a smaller `maxPerKind`, or a `target` |
| `CANCELLED` | AgentSession | The call was abandoned before the user answered its approval, so the request was taken down and a late answer does nothing |
| `SKILL_UNKNOWN` | AgentSession | The attached agent skill's id no longer resolves: the file moved, changed agents, or outgrew the size cap. Reopen the `/` picker and choose again |

## Scheduled tasks

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `TASK_NOT_FOUND` | Daemon | No task with that id. It was deleted from another browser or with `browsentic tasks` |
| `TASK_LIMIT` | Daemon | 25 tasks are already scheduled. Delete one first |
| `REPLAY_UNAVAILABLE` | Extension | The task's recording is gone, was never turned into steps, or needs a value the task does not hold |

## Agents

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `AGENT_MISSING` | Runner | The chosen agent's binary is not on the *daemon's* `PATH`. Set `agents.<name>.bin` to an absolute path |
| `AGENT_NEEDS_PERMISSION` | Runner | Antigravity has no rule allowing Browsentic's MCP tools (`browsentic agent fix antigravity`), Grok Build or Cursor CLI is not signed in (`grok login`, `cursor-agent login`), Qwen Code has no model provider configured (`qwen`, then `/auth`), or OpenCode is signed in to no provider (`opencode auth login`) |
| `AGENT_UNUSABLE` | Runner | The CLI is present but cannot run, usually because it is too old for the flags Browsentic passes. On Windows, also a batch file that is not an npm or pnpm shim: set `agents.<name>.bin` to the program it runs |
| `AGENT_UNSAFE` | Runner | The run was stopped before the agent could act on the machine: its plan had lost its containment, which is a bug in Browsentic, or the CLI itself said it had not applied it (Grok Build offering tools Browsentic never asks for, Qwen Code reporting a denied tool or a second MCP server as registered, OpenCode reporting that a tool outside the browser ran, Codex running a shell command or changing a file with both switched off, or Cursor CLI getting an answer from an MCP server the run denies). Update both, and report it |

## Guardrails

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `DECLINED` | Approval gate | The user said no. **Final**: do not seek another route to the same effect |
| `BLOCKED` | Policy | A `deny` rule matched, or a `confirm` with nobody to answer it. The message names why. [Guide](../guide/approvals.md) |
| `SITE_BLOCKED` | Extension | The page is on the user's Blocked sites list, or the action would take the browser to a blocked site or ended up on one. Also returned for every page action while that list cannot be read. **Final**: do not retry or reach it another way; tell the user. [Guide](../guide/features/blocked-sites.md) |
| `SECRET_NOT_RELEASABLE` | Extension | A sealed secret placeholder was passed somewhere it cannot be released. Only `page_fillInput`'s `value` and `page_typeText`'s `text` release one |
| `SECRET_EXPIRED` | Extension | That placeholder is no longer held: it aged out, or it was read in an earlier browser session. Read the value again |
| `MAPPING_READ_ONLY` | Mapping gate | A mapping run may only call the 14 read-only actions (plus `page_clickElement` when `allowClicks` is on) |
| `MAPPING_OFF_SITE` | Mapping gate | Navigation must be an absolute URL on the mapped origin, `back` and `forward` included |
| `MAPPING_BUDGET` | Mapping gate | The page or screenshot budget is spent |
| `MAPPING_TAB_CHANGED` | Mapping gate | The tab the run was pinned to is gone |

## Downloads

A capture refused with `DOWNLOAD_OFF_SCOPE`, `DOWNLOAD_REFUSED` or `DOWNLOAD_TOO_LARGE` also
**deletes the file the browser already wrote**, so it leaves nothing behind to clean up. Those
refusals are terminal for that file: retrying downloads it again and refuses it again.

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `NO_DOWNLOAD_STARTED` | Extension | The click produced no download. It probably opened a page instead: check where the tab landed, or pass the file's url directly |
| `DOWNLOAD_FAILED` | Extension | The browser stopped the transfer. The message carries its reason |
| `DOWNLOADS_UNAVAILABLE` | Extension | The loaded extension predates the `downloads` permission. Reload it and accept the prompt |
| `DOWNLOAD_OFF_SCOPE` | Daemon | The file came from a host this run was never pointed at. Ask the user, or start a run that names that site |
| `DOWNLOAD_REFUSED` | Daemon | An executable. Not overridable, by design |
| `DOWNLOAD_TOO_LARGE` | Daemon | Over 100 MB to capture, or over 25 MB to attach to a page |
| `DOWNLOAD_NOT_FOUND` | Daemon | No captured download with that id. Call `page_listDownloads` |
| `DOWNLOAD_MISSING` | Daemon | It was captured but is no longer on disk (swept, or deleted). Capture it again |
| `DOWNLOAD_SAVE_FAILED` | Daemon | The file could not be moved into the download folder. The message carries the reason |

## Attached files

These are not tool errors. They are the reason on a file analyst's report, shown on the file's chip
and handed to the agent with the file so it can say why it cannot answer from it.

| Code | Verdict | Meaning and next move |
| --- | --- | --- |
| `UNSUPPORTED_TYPE` | rejected | Not text, a PDF or an image (an archive, an Office file, a program), or a PDF or image the active agent cannot open. The message names the agents that can |
| `FILE_TOO_LARGE` | rejected | Over 10 MB, or over its kind's limit: text 5 MB, PDF 10 MB, image 5 MB |
| `EMPTY` | rejected | The file has no bytes |
| `UNREADABLE` | rejected | The analyst opened it and could not read it: encrypted, password-protected or corrupted |
| `TIMEOUT` | failed | The analyst took longer than 60 seconds. **Retry** on the chip reads it again |
| `CANCELLED` | failed | The file was removed, its conversation ended, or the browser disconnected while it was being read |
| `FILE_NOT_FOUND` | failed | The browser no longer holds the file's bytes. Attach it again |
| `AGENT_FAILED` | failed | The agent could not start, or returned something that was not a report. The message says which |


## Android phones

These come from a conversation on the [phone tab](../guide/features/android.md). The readiness codes
(`ADB_MISSING`, `NO_DEVICE`, `DEVICE_UNAUTHORIZED` and the rest) are what `browsentic android` and
the apps report; each has a row in [troubleshooting](../guide/troubleshooting.md#android-phones).

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `NOT_ON_PHONE` | Daemon or extension | The tool works only in desktop tabs. A phone run is not offered it, so only an MCP client or a stale skill reaches this. Do that step in a desktop tab |
| `PHONE_GONE` | Extension | The phone session ended: the phone was unplugged, Chrome closed on it, Android was switched off, or the Bridge went away. **Retrying will not help**; reconnect from the phone tab |
| `PHONE_PAGE_UNREACHABLE` | Extension | The page on the phone was loading, or kept navigating, so its script world could not be made. Try again once it has loaded |
| `TAP_MISSED` | Extension | The point was outside the visible part of the phone's screen, so nothing was touched. Scroll it into view first |
| `NAVIGATION_FAILED` | Extension | Chrome on the phone could not open the address; the message carries Chrome's reason |
| `CHROME_NOT_RUNNING` | Daemon | Chrome is not open on the phone, so the session could not start. Open it, or run `browsentic android open` |
| `NOT_OWNER` | Daemon | Another paired browser is already driving this phone. One browser drives a phone at a time |
| `NOT_CHECKED` | Daemon | `browsentic android` asked before any browser or app was watching for phones, so the Bridge has not looked yet |
| `CDP_ERROR` | Daemon | Chrome on the phone refused a command. The message carries Chrome's reason |

---

## See also

- [guide/troubleshooting.md](../guide/troubleshooting.md): symptom, cause and fix
- [guide/limits.md](../guide/limits.md): the errors that mark a boundary rather than a bug
- [internals/guardrails.md](../internals/guardrails.md): how a guardrail decision is reached
