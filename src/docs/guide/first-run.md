---
layout: layouts/doc.njk
pageKey: docs
title: "First run"
seoTitle: "First run — Browsentic user guide"
description: "You have installed and paired. This is what you are looking at, and what to try first. Click the Browsentic toolbar icon and press Open side panel, or open…"
deck: "You have installed and paired. This is what you are looking at, and what to try first."
docsPath: "guide/first-run.md"
section: "guide"
sectionLabel: "User guide"
sectionOrder: 1
order: 2
isIndex: false
permalink: "/docs/guide/first-run/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/first-run.md"
---
---

## Open the side panel

Click the Browsentic toolbar icon and press **Open side panel**, or open it from Chrome's side
panel menu. The popup is for setup — pairing, picking an agent, press-to-talk — and the side panel
is where you actually work.

## The panel, top to bottom

| | |
| --- | --- |
| **Status pill** | Connection state. Click it to reopen the pairing form or switch agents without going back to the popup. |
| **Sessions strip** | One row per tab that has a conversation: its live title, a pulsing dot while it is working, how many messages it holds. Collapses to a single line. See [Conversations](/docs/guide/features/conversations/). |
| **Chat · History · Skills · Recordings** | The four sections. Chat is where you talk; the others are covered in [Features](/docs/guide/features/). |
| **Timeline** | Every action as it happens, with what it targeted and what came back. |
| **Composer** | Type, or press the mic to dictate. |

## Your first instruction

Open any ordinary website — not `chrome://` pages, which cannot host a content script — and try:

```
what's on this page?
```

You should see the agent call `page_getPageInfo`, then answer. That round trip proves all four
pieces work: panel → daemon → agent CLI → browser.

Then try something that acts:

```
scroll to the bottom
```

That one carries a ⚡ and returns instantly. It never left the browser — it matched the local
grammar and ran directly, no agent involved. See [Instant commands](/docs/guide/features/instant-commands/).

Then something multi-step:

```
find the search box, type "wireless headphones" and show me what comes back
```

Follow-ups continue the same conversation, so **"now click the second one"** works.

## What to expect the first time something is consequential

Submitting a form pauses the run and asks. You get **Allow**, **Deny**, and **Always on ‹host›**
— which grants that one action on that one site and stops asking.

Denying is final: the agent is told to report it and stop, not to find another route to the same
effect. [Approvals](/docs/guide/approvals/) covers the whole gate.

## If it does not answer

Check in this order:

1. `browsentic status` — is the extension `connected`?
2. `browsentic agent` — is the agent CLI installed and ready?
3. `browsentic logs` — run starts, routed skills, every tool call

[Troubleshooting](/docs/guide/troubleshooting/) maps symptoms to fixes.

---

## Where to go next

- **[Features](/docs/guide/features/)** — one page per capability
- **[Choosing an agent](/docs/guide/agents/)** — if you would rather run Codex or Antigravity
- **[Configuration](/docs/guide/configuration/)** — `~/.browsentic/config.json`
- **[Limits](/docs/guide/limits/)** — worth reading early rather than discovering
