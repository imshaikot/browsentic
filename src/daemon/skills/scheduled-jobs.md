---
name: scheduled-jobs
description: Do something on a clock — once after a delay, or over and over on an interval — by scheduling the work and letting the browser wake you when it is due.
triggers: [remind me, reminder, schedule, minutes, hours, every minute, every hour, every few, check every, keep checking, check back, check again, poll, recurring, on a timer, set a timer, come back to, do this later, wake me]
---

The extension keeps the clock, not you. You set a timer, end your turn, and the browser starts a fresh turn with your own words in it when the time comes. Nothing is running in between — no polling, no waiting, no tokens.

## 1. A timer or a monitor?

They solve different problems and picking wrong wastes the user's time.

- **The page will show you when it is done** — a progress bar, a completion phrase, a spinner that vanishes → `page_startMonitor`. It watches continuously and fires the moment the condition is true. Read `monitor-progress` for that.
- **There is nothing to watch, only work to re-do** — reload and compare, re-run a search, look at a dashboard that updates on its own, remind the user → `page_startTimer`.

"Tell me when this upload finishes" is a monitor. "Check the deploy queue every five minutes" is a timer. If a real signal exists, a monitor beats a timer every time: it is exact, and it does not re-do work that has not changed.

## 2. Translate what they said

| They said | `afterMs` | `repeat` |
| --- | --- | --- |
| "in ten minutes" | `600000` | `false` |
| "every two minutes" | `120000` | `true` |
| "every half hour until it lands" | `1800000` | `true` |

Thirty seconds is the floor the browser can keep, and a day is the ceiling. A repeating timer always stops at `maxRuns` — set it to cover how long the user actually expects to wait (twelve by default), so a forgotten timer cannot run all night.

## 3. Write the prompt for your future self

The `prompt` is what you will be handed when it fires, as a new instruction in this same conversation. Write it as a job, with the finish line in it:

> "Reload the deploy page and check whether build #4412 has finished. If it has, tell me the result and call page_stopTimer. If it hasn't, say nothing and end the turn."

Two things make that work:

- **Say when to stop.** A repeating timer that has done its job should cancel itself — that is the whole point of handing you `page_stopTimer` from inside the fired turn. Without it the user gets the same answer twelve times.
- **Say when to stay quiet.** Most fires of a "watch for X" timer find nothing. Tell yourself to end the turn without a report unless something changed, or you will fill the panel with "still building".

You keep the conversation, so you do not need to restate context — refer to what you already know.

## 4. Set it and stop

`page_startTimer` with a short `label` the user will recognise, then tell them what you scheduled and end the turn. Do not stay to see the first fire.

Five timers at most, across everything.

## 5. Reminders that need no agent

If the user only wants to be told something at a time — "remind me to check the oven in twenty minutes" — pass `deliver: "notify"`. The `prompt` becomes the notification text, and nothing wakes you. Cheaper, and it works even if the panel is closed.

`deliver: "agent"` is the default and needs a Browsentic conversation to wake. Called from an outside MCP client there is none, and it refuses with `NO_CONVERSATION` — use `notify`, or that client's own scheduler.

## 6. Later asks

- "Is that still running?" → `page_timerStatus`: fires so far, fires skipped, when the next one is due, recent log lines.
- "Stop that" → `page_stopTimer`. With several scheduled, an omitted id cancels nothing and lists them — ask which, then cancel by id.
- A timer that fires while the conversation is still working on the previous turn **skips that beat** rather than queueing behind it. Skips do not count against `maxRuns`, and `page_timerStatus` reports them. A slow job on a fast interval simply runs less often than asked — until twenty fires have been skipped, at which point the timer gives up and says so, because the interval was wrong for the job.
- Ending the conversation cancels its timers. They do not outlive it.
