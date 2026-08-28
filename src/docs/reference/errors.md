---
layout: layouts/doc.njk
pageKey: docs
title: "Error reference"
seoTitle: "Error reference — Browsentic reference"
description: "Errors are { ok: false, error: { code, message } } all the way through, surfaced to MCP clients as isError with CODE: message."
deck: "Errors are { ok: false, error: { code, message } } all the way through, surfaced to MCP clients as isError with CODE: message."
docsPath: "reference/errors.md"
section: "reference"
sectionLabel: "Reference"
sectionOrder: 3
order: 2
isIndex: false
permalink: "/docs/reference/errors/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/reference/errors.md"
---
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
| `PICK_CANCELLED` | Content script | The user dismissed A-Eye without pointing at anything. **Terminal** — ask in words rather than asking them to point again |
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
| `SKILL_UNKNOWN` | AgentSession | The attached agent skill's id no longer resolves — the file moved, changed agents, or outgrew the size cap. Reopen the `/` picker and choose again |

## Agents

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `AGENT_MISSING` | Runner | The chosen agent's binary is not on the *daemon's* `PATH`. Set `agents.<name>.bin` to an absolute path |
| `AGENT_NEEDS_PERMISSION` | Runner | Antigravity has no rule allowing Browsentic's MCP tools. `browsentic agent fix antigravity` |
| `AGENT_UNUSABLE` | Runner | The CLI is present but cannot run — usually too old for the flags Browsentic passes |

## Guardrails

| Code | Origin | Meaning and next move |
| --- | --- | --- |
| `DECLINED` | Approval gate | The user said no. **Final** — do not seek another route to the same effect |
| `BLOCKED` | Policy | A `deny` rule matched, or a `confirm` with nobody to answer it. The message names why. [Guide](/docs/guide/approvals/) |
| `SECRET_NOT_RELEASABLE` | Extension | A sealed secret placeholder was passed somewhere it cannot be released. Only `page_fillInput`'s `value` and `page_typeText`'s `text` release one |
| `SECRET_EXPIRED` | Extension | That placeholder is no longer held — it aged out, or it was read in an earlier browser session. Read the value again |
| `MAPPING_READ_ONLY` | Mapping gate | A mapping run may only call the 14 read-only actions (plus `page_clickElement` when `allowClicks` is on) |
| `MAPPING_OFF_SITE` | Mapping gate | Navigation must be an absolute URL on the mapped origin — `back` and `forward` included |
| `MAPPING_BUDGET` | Mapping gate | The page or screenshot budget is spent |
| `MAPPING_TAB_CHANGED` | Mapping gate | The tab the run was pinned to is gone |

---

## See also

- [guide/troubleshooting.md](/docs/guide/troubleshooting/) — symptom → cause → fix
- [guide/limits.md](/docs/guide/limits/) — the ones that are boundaries rather than bugs
- [internals/guardrails.md](/docs/internals/guardrails/) — how a decision is reached
