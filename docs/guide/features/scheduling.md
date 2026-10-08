# Scheduled tasks and timers

Scheduled tasks and timers run browser work on a clock, for jobs the page gives no signal to watch:
a queue that only changes when you reload it, a deploy board with no progress bar, a reminder.

```
check the deploy queue every five minutes and tell me when something lands
```

```
in ten minutes, reload this and tell me whether the build passed
```

There are two kinds. A **scheduled task** is one you set up and leave running: every weekday, every
Friday evening, once tomorrow morning. A **timer** is one the agent sets for itself during a
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
arrives as a notice on the page you are looking at. Every run is added to the task's history (when it
ran, how it went, its one-line result and, for the last three runs, the whole transcript), never to
the History tab.

| | |
| --- | --- |
| **What it does** | An instruction the agent follows, or a recording replayed step by step. A replay needs no agent and spends no tokens; when a step no longer fits the page, the agent takes over from there |
| **When** | Once at a set time, on chosen days at chosen times, or at an interval, optionally only between two times of day. Five minutes is the shortest interval |
| **Afterwards** | Tell you every run, only when one fails, or never. Skip a missed run, or run it once when things are back. Stop after some runs, or on a date |

Before you save, the editor shows the next three runs and, for an instruction, how many agent runs a
week the schedule adds up to, since each one spends tokens.

Browsentic Bridge keeps the schedule in `~/.browsentic/schedules.json`, so one list covers every
browser paired with it. From a terminal, `browsentic tasks` lists the tasks and pauses, resumes or
deletes one.

### What has to be running

A run needs the browser open and Browsentic Bridge running. The Bridge starts itself when the
browser needs it: `browsentic setup`, or installing the app, registers a small helper that Chrome,
Edge, Brave and Firefox can launch, whether the extension came from a store or a folder.
`browsentic status` says which browsers have it.

After `browsentic stop`, the browser leaves the Bridge down until `browsentic start` or an MCP
client brings it back.

A run that falls due while the browser is closed or the computer is asleep is **missed**. By default
it waits and runs once as soon as a browser is back, logging how many runs it missed. A task set to
**Skip it** logs the miss at once and waits for its next time.

### Approvals with nobody watching

A scheduled run follows the same [guardrails](../approvals.md) as one you start yourself. When an
action needs your approval, a card with **Allow** and **Deny** appears on the page you are looking
at. To allow it on that site permanently, answer from the task's conversation in the side panel
instead. With no answer in ten minutes the action is declined and the run says so. The card accepts
only a real click, and none in its first moment on screen, so the page underneath cannot press
**Allow** for you.

A scheduled run never gets Live tools, and it is told to end on a single line that stands alone,
because that line is what the notice and the history show.

### Task or timer?

| | Scheduled task | Timer |
| --- | --- | --- |
| Set by | you, in the Schedules tab | the agent, during a conversation |
| Runs in | a fresh background tab each time | the conversation that set it |
| When | clock times, days of the week, intervals | "in ten minutes", "every two minutes" |
| Lasts | until you delete it | until its conversation ends, a day at most |

The rest of this page is about timers.

---

## How a timer runs

Browsentic schedules the job in the extension and the agent's turn ends. Nothing runs in between: no
polling, no open connection, no tokens.

When the timer is due, Browsentic **starts a fresh turn in the conversation that set it**, carrying
the words the agent wrote for itself. The agent picks up with everything it already knew, does the
work, and stops again until the next fire.

Because the schedule lives in the extension, it survives the agent finishing, the MCP client
disconnecting, and the service worker being shut down between fires.

---

## Timer or monitor?

| | [Monitoring](monitoring.md) | Scheduling |
| --- | --- | --- |
| Fires on | a condition the page shows, such as a bar reaching 100% or a phrase appearing | a clock |
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
repeating timer carries a `maxRuns` cap (twelve by default), so a forgotten one cannot run all
night. Five timers at most, across everything.

A repeating job usually cancels itself: the agent writes "if the build has finished, tell me and
stop the timer" into its own prompt, and the fired turn calls `page_stopTimer` once there is an
answer.

---

## Reminders that need no agent

If you only want to be told something at a set time, no agent is needed:

```
remind me to check the oven in twenty minutes
```

That schedules a browser notification with the text and starts no agent. It works with the side
panel closed.

---

## When a fire lands on a busy conversation

A timer that comes due while its conversation is still working on the previous turn **skips that
fire** instead of queueing behind it. A five-minute job on a two-minute timer runs less often than
asked instead of building up a backlog.

Skips do not count against `maxRuns`, and `page_timerStatus` reports them alongside the fires that
did happen. After twenty skipped fires the timer gives up and says why: by then the interval is
clearly wrong for the job.

Timers belong to the conversation that set them. Ending it, or closing its tab, cancels them, and one
conversation's timers never reach another's.

---

## From an MCP client

`page_startTimer` needs a side-panel conversation to wake, and a client on the optional MCP endpoint
is not one: a timer set from there fails with `NO_CONVERSATION`. Use `deliver: "notify"` for a
reminder, or your client's own scheduler for work (Claude Code, for instance, has `/loop` and
scheduled agents).

---

## See also

- [reference/tools.md § Scheduling](../../reference/tools.md#scheduling): every parameter
- [Monitoring](monitoring.md): the condition-driven half of the same problem
- [Skills](skills.md): the `scheduled-jobs` skill routes these requests
