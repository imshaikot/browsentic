---
layout: layouts/doc.njk
pageKey: docs
title: "Scheduled jobs"
seoTitle: "Scheduled jobs — Browsentic features"
description: "Some work is not waiting for a signal — it is waiting for a clock. A queue that only changes when you reload it. A deploy board with no progress bar. A…"
deck: "Some work is not waiting for a signal — it is waiting for a clock. A queue that only changes when you reload it. A deploy board with no progress bar. A reminder."
docsPath: "guide/features/scheduling.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 7
isIndex: false
permalink: "/docs/guide/features/scheduling/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/scheduling.md"
---
```
check the deploy queue every five minutes and tell me when something lands
```

```
in ten minutes, reload this and tell me whether the build passed
```

---

## What happens

Browsentic schedules the job in the extension and the agent's turn ends. Nothing runs in between —
no polling, no open connection, no tokens.

When the timer is due, the extension **starts a fresh turn in the conversation that set it**,
carrying the words the agent wrote for itself. The agent picks up with everything it already knew,
does the work, and stops again until the next fire.

The schedule lives in the extension, so it survives the agent finishing, the MCP client
disconnecting, and the service worker being shut down between fires.

---

## Timer or monitor?

They look similar and solve different problems.

| | [Monitoring](/docs/guide/features/monitoring/) | Scheduling |
| --- | --- | --- |
| Fires on | a condition the page shows — a bar reaching 100%, a phrase appearing | a clock |
| Best for | uploads, builds, deploys with visible progress | queues, dashboards, inboxes, reminders |
| Between fires | watches the page continuously | nothing runs |
| Wakes the agent | once, at the end | every time it fires |

If the page can tell you when it is done, a monitor is exact and cheaper. A timer is for work that
has to be **re-done** to find out.

---

## Once, or over and over

| You say | What is set |
| --- | --- |
| "in ten minutes" | one fire, ten minutes out |
| "every two minutes" | a repeating fire, two minutes apart |

Thirty seconds is the shortest interval a browser can keep, and a day is the longest. Every
repeating timer carries a `maxRuns` cap — twelve by default — so a forgotten one cannot run all
night. Five timers at most, across everything.

A repeating job usually cancels itself: the agent writes "if the build has finished, tell me and
stop the timer" into its own prompt, and the fired turn calls `page_stopTimer` once there is an
answer.

---

## Reminders that need no agent

If you only want to be told something at a time, there is nothing for an agent to do:

```
remind me to check the oven in twenty minutes
```

That schedules a browser notification carrying the text, and wakes no agent at all. It works with
the side panel closed.

---

## When a fire lands on a busy conversation

A timer that comes due while its conversation is still working on the previous turn **skips that
beat** rather than queueing behind it. A five-minute job on a two-minute timer simply runs less
often than asked, instead of piling up a backlog.

Skips do not count against `maxRuns`, and they are reported by `page_timerStatus` alongside the
fires that did happen. After twenty skipped fires the timer gives up and says why — at that point
the interval was simply wrong for the job.

Timers belong to the conversation that set them. Ending it, or closing its tab, cancels them —
they never outlive it, and one conversation's timers never reach another's.

---

## From an MCP client

`page_startTimer` needs a side-panel conversation to wake, and an outside MCP client is not one: a
timer there fails with `NO_CONVERSATION`. Use `deliver: "notify"` for a reminder, or your client's
own scheduler for work — Claude Code, for instance, has `/loop` and scheduled agents.

---

## See also

- [reference/tools.md § Scheduling](/docs/reference/tools/#scheduling) — every parameter
- [Monitoring](/docs/guide/features/monitoring/) — the condition-driven half of the same problem
- [Skills](/docs/guide/features/skills/) — the `scheduled-jobs` skill routes these requests
