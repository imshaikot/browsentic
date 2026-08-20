# Error reference

Errors are `{ ok: false, error: { code, message } }` all the way through, surfaced to MCP clients as
`isError` with `CODE: message`.

They are **recoverable signals**, and each implies a different next move. Two design choices show up
repeatedly: failures carry the *fix* in the message, and a failed tool call never crashes a run.

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
| `TARGET_NOT_FOUND` | Content script | Nothing matched. The page changed — take a fresh snapshot |
| `INVALID_TARGET` | Content script | A target with neither `selector` nor `text`. `role`/`nth` only narrow |
| `DEBUGGER_UNAVAILABLE` | Extension | Chrome's debugger could not attach — usually DevTools is open on that tab. Close it, or use `page_clickElement` |
| `CAPTCHA_NOT_FOUND` | Extension | No known captcha widget, so whatever is blocking the run is something else |

## Input and dispatch

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `INVALID_INPUT` | Dispatch | zod rejected the input; the message names the field |
| `UNSUPPORTED` | Action | e.g. a non-http(s) URL |
| `TIMEOUT` | Link or action | A wait expired, or the extension did not answer in the window for that action |
| `ACTION_FAILED` | Action | `execute()` threw — e.g. `back` with no history |
| `UNKNOWN_ACTION` | Registry / daemon | Tool-registry skew, or a reserved action reached from outside |

## Runs and sessions

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `RUN_IN_PROGRESS` | AgentSession | One instruction at a time **per tab session**; other sessions are unaffected |
| `RUN_LIMIT` | AgentSession | Too many sessions running at once — `maxConcurrentRuns`, default 3, ceiling 8 |
| `SESSION_LIMIT` | Extension | Eight tab sessions are already open |
| `SESSION_TAB_CLOSED` | Extension | Every tab this conversation was working in has been closed |
| `TAB_IN_USE` | Extension | That tab belongs to another Browsentic conversation |
| `RUN_INACTIVE` | AgentSession | The run was cancelled while a tool call was in flight |

## Agents

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `AGENT_MISSING` | Runner | The chosen agent's binary is not on the *daemon's* `PATH`. Set `agents.<name>.bin` to an absolute path |
| `AGENT_NEEDS_PERMISSION` | Runner | Antigravity has no rule allowing Browsentic's MCP tools. `browsentic-mcp agent setup antigravity` |
| `AGENT_UNUSABLE` | Runner | The CLI is present but cannot run — usually too old for the flags Browsentic passes |

## Guardrails

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `DECLINED` | Approval gate | The user said no. **Final** — do not seek another route to the same effect |
| `BLOCKED` | Policy | A `deny` rule matched, or a `confirm` with nobody to answer it. The message names why. [Guide](../guide/approvals.md) |
| `MAPPING_READ_ONLY` | Mapping gate | A mapping run may only call the 13 read-only actions (plus `page_clickElement` when `allowClicks` is on) |
| `MAPPING_OFF_SITE` | Mapping gate | Navigation must be an absolute URL on the mapped origin — `back` and `forward` included |
| `MAPPING_BUDGET` | Mapping gate | The page or screenshot budget is spent |
| `MAPPING_TAB_CHANGED` | Mapping gate | The tab the run was pinned to is gone |

---

## See also

- [guide/troubleshooting.md](../guide/troubleshooting.md) — symptom → cause → fix
- [guide/limits.md](../guide/limits.md) — the ones that are boundaries rather than bugs
- [internals/guardrails.md](../internals/guardrails.md) — how a decision is reached
