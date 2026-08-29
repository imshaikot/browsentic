---
layout: layouts/doc.njk
pageKey: docs
title: "Diagnostics"
seoTitle: "Diagnostics — Browsentic features"
description: "Reading what a page reports — console errors, uncaught exceptions, failed requests — rather than what it renders. The difference between \"verify it in the…"
deck: "Reading what a page reports — console errors, uncaught exceptions, failed requests — rather than what it renders. The difference between \"verify it in the browser\" and \"verify it in the browser and tell me why it broke\"."
docsPath: "guide/features/diagnostics.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 10
isIndex: false
permalink: "/docs/guide/features/diagnostics/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/diagnostics.md"
---
---

## The short version

```
page_startDiagnostics { reload: true }
… reproduce the problem …
page_readConsole  { level: "error" }
page_readNetwork  { status: "problems" }
page_stopDiagnostics
```

Chrome only. It shows the debugger bar for as long as it runs.

---

## Why it is a session and not a read

Every other tool answers from the page as it stands right now. This one cannot: `Runtime.consoleAPICalled`
and `Network.responseReceived` are delivered **only while Chrome's debugger is attached**, and there is
no backlog kept anywhere to go and fetch afterwards. By the time anyone thinks to ask what errored, the
event is long gone.

So it has the shape [monitoring](/docs/guide/features/monitoring/) has — start, read, stop — for the same reason: the
interesting thing happens between two calls, not during one.

The practical consequence is the whole usage rule. **Start it before the thing you are diagnosing
happens.** Attach after the failure and you get an empty buffer.

`reload: true` handles the common case where the failure *is* the load — a blank screen, a chunk that
404s, a component that throws on mount. It reloads once recording has started, so those errors land in
the buffer instead of having happened before anything was watching.

---

## The bar across your browser

While a recording runs, Chrome shows **"Browsentic is debugging this browser"** across the top of the
window, with a **Cancel** button. That is Chrome's, not Browsentic's, and it cannot be suppressed —
it is the price of the only API that can see a page's console.

Two things make it bounded rather than permanent:

| | |
| --- | --- |
| **A timeout** | Five minutes by default, thirty at most. It detaches on its own, so a forgotten recording cannot leave the bar up |
| **The run** | Inside a side-panel conversation, a recording ends when the turn that started it ends |

Pressing **Cancel** in the bar detaches immediately; the recording reports `phase: "detached"` and what
it already collected stays readable.

An MCP client — Claude Code, Codex — has no side-panel turn to end, so its recordings live until it
stops them or the timeout fires. That is deliberate: it is what makes the tools usable across several
calls.

---

## What comes back

**`page_readConsole`** — level, text, the file and line that logged it, and a stack for errors. Three
kinds are collected: `console` (a `console.*` call), `exception` (uncaught) and `browser` (Chrome's own
reports — CSP violations, mixed content, resources that failed to load).

Start with `level: "error"`. A busy SPA logs constantly and almost none of it is the fault.

**`page_readNetwork`** — method, URL, status, resource type, timing, size, and the browser's own error
text for requests that failed. Start with `status: "problems"`, which is everything that failed outright
or came back 4xx/5xx. `status: "pending"` is the other useful filter: a request that never came back is
why the spinner is still spinning.

Both take `contains`/`urlContains` and `limit` to narrow, and `drain: true` to forget what was returned
so a second call reports only what happened since.

### When the buffers overflow

500 console entries and 1,000 requests are kept, newest first out the far end. Every read reports
`droppedConsole` and `droppedNetwork` — non-zero means older entries were evicted and the picture is
partial. A truncated answer that says so is worth more than a complete-looking one that lies.

---

## Security: this is the richest surface in the product

Network data is where credentials actually live. Request headers carry `Cookie` and
`Authorization: Bearer …`; responses carry `Set-Cookie`; URLs carry tokens in query strings; bodies
carry session tokens, API keys and other people's personal data wholesale.

The policy splits metadata from payload:

| | |
| --- | --- |
| **Metadata** — method, URL, status, type, timing, size | Free, like any read |
| **Headers** — request and response | Off by default; `includeHeaders: true` turns them on, [sanitized](/docs/internals/guardrails/) like everything else |
| **Bodies** | **Denied by default.** `includeBodies: true` returns `BLOCKED` unless the user allows it |

Everything that does come back crosses the socket through the same deterministic sanitizer as every
other result: a cookie, a bearer token or an API key in a header, a URL or a body is replaced by a
sealed placeholder such as `⟦token:4f2a@example.com⟧` before it reaches the agent. The real value stays
in the browser.

**Bodies are denied by default** for the same reason [raw HTML is](/docs/guide/approvals/): the read that
diagnoses is much narrower than the read that empties the page, and the sanitizer seals shapes it
recognises — a JSON blob of somebody's account data is not one of them. Status, timing, headers and the
browser's error text answer nearly every real question. To allow them anyway:

```json
{ "guardrails": { "rules": { "network-body-read": "allow" } } }
```

or the same row in the guardrail settings in the side panel. Bodies also only exist while the recording
is attached — Chrome discards them once its own buffer moves on — so a `stopDiagnostics` before the read
means no bodies regardless of policy.

---

## Edges

**DevTools wins.** Chrome allows one debugger per tab. With DevTools open on that tab, attaching fails
with `DEBUGGER_UNAVAILABLE` and a hint saying so — which is annoying precisely because it is the moment
a developer is most likely to ask. Close DevTools and retry.

**Firefox has none of this.** There is no CDP, so all four tools return `UNSUPPORTED`. The same is true
of `page_trustedClick` and the captcha tools.

**Top-level frame only.** What a cross-origin iframe logs to its own console is not collected.

**Two tabs at a time**, one recording per tab. Starting a third returns `DIAGNOSTICS_LIMIT`.

**http(s) only** — browser pages report nothing to attach to.

---

## See also

- [reference/tools.md](/docs/reference/tools/#diagnostics) — the four tools and their parameters
- [reference/errors.md](/docs/reference/errors/) — `DEBUGGER_UNAVAILABLE`, `DIAGNOSTICS_NOT_FOUND` and friends
- [Approvals](/docs/guide/approvals/) — the `network-body-read` rule
- [Monitoring](/docs/guide/features/monitoring/) — the same start/read/stop shape, for progress rather than faults
- [Captchas](/docs/guide/features/captcha/) — the other feature built on Chrome's debugger
