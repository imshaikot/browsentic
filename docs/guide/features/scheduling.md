# Scheduled jobs

Some work is not waiting for a signal — it is waiting for a clock. A queue that only changes when
you reload it. A deploy board with no progress bar. A reminder.

```
check the deploy queue every five minutes and tell me when something lands
```

```
in ten minutes, reload this and tell me whether the build passed
```

There are two kinds. A **scheduled task** is one you set up and leave running — every weekday, every
Friday evening, once tomorrow morning. A **timer** is one the agent sets for itself in the middle of a
conversation. Tasks come first on this page.

---

## Scheduled tasks

Open the **Schedules** tab in the side panel and press **New task**. Or turn on the clock beside the
message box and send: what you typed becomes the task, and you pick when. **Repeat this…** under a
message you already sent, and **Schedule** on a recording, do the same.

```
every weekday at 09:00, open github.com/pulls and summarise what is waiting on my review
```

Each run opens its own background tab on the task's page, does the job and closes the tab. The result
arrives as a notice on the page you are looking at, and every run lands in the task's history — when it
ran, how it went, its one-line result and, for the last three runs, the whole transcript. Scheduled
runs never fill up the History tab.

| | |
| --- | --- |
| **What it does** | An instruction the agent follows, or a recording replayed step by step. A replay needs no agent and spends no tokens; when a step no longer fits the page, the agent takes over from there |
| **When** | Once at a set time, on chosen days at chosen times, or every so often — optionally only between two times of day. Five minutes is the shortest interval |
| **Afterwards** | Tell you every run, only when one fails, or never. Skip a missed run, or run it once when things are back. Stop after some runs, or on a date |

The editor shows the next three runs before you save, and for an instruction how many agent runs a
week the schedule adds up to — each one spends tokens.

The daemon keeps the schedule, in `~/.browsentic/schedules.json`, so one list covers every browser
paired with it. `browsentic tasks` lists the tasks from a terminal, and pauses, resumes or deletes one.

### What has to be running

A run needs the browser open and the daemon up. The daemon starts itself when the browser needs it:
`browsentic setup` registers a small helper that Chrome, Edge, Brave and Firefox can launch, and
`browsentic status` says which browsers have it.

A run that falls due while the browser is closed or the computer is asleep is logged as **missed**. By
default it then runs once when both are back; a task set to **Skip it** just waits for its next time.

### Approvals with nobody watching

A scheduled run follows the same [guardrails](../approvals.md) as one you start yourself. When an
action needs your OK, a card appears on the page you are looking at, with **Allow**, **Deny** and
**Always on ‹site›**. With no answer in ten minutes the action is declined and the run says so. The
card only takes a real click, and none in its first moment on screen, so the page underneath cannot
press **Allow** for you.

A scheduled run never gets Live tools, and it is told to end on one line that stands alone, because
that line is what the notice and the history show.

### Task or timer?

| | Scheduled task | Timer |
| --- | --- | --- |
| Set by | you, in the Schedules tab | the agent, during a conversation |
| Runs in | a fresh background tab each time | the conversation that set it |
| When | clock times, days of the week, intervals | "in ten minutes", "every two minutes" |
| Lasts | until you delete it | until its conversation ends, a day at most |

The rest of this page is about timers.

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

| | [Monitoring](monitoring.md) | Scheduling |
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

- [reference/tools.md § Scheduling](../../reference/tools.md#scheduling) — every parameter
- [Monitoring](monitoring.md) — the condition-driven half of the same problem
- [Skills](skills.md) — the `scheduled-jobs` skill routes these requests
