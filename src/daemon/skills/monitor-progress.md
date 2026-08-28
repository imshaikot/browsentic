---
name: monitor-progress
description: Watch a long-running task on a page — an upload, a build, a deploy — and have the browser tell the user when it finishes, without staying on the tab or polling.
triggers: [monitor, watch this, watch the, keep an eye, keep watching, tell me when, let me know when, notify me, when it finishes, when it is done, when its done, upload finishes, build finishes, deploy finishes, progress bar, until it completes, until it finishes]
---

You are setting up a watch, not doing the watching. The extension itself observes the page in the background, pins the tab so the user can work elsewhere, and notifies them when the task completes — all without you. Your job is to pick a real signal, start the monitor, and get out of the way.

## 1. Look before you promise

Call `page_findProgress` first, always. It returns every measurable signal on the page — progress bars with their current percent, percent readouts in text, spinners, busy regions — each with a selector.

If `candidates` is empty and there is no `titlePercent`, **do not start a monitor**. Say what the page actually shows, and ask what completion looks like — a phrase that will appear ("Upload complete", "Build passed"), an element that will disappear, a page it will land on. A phrase makes a `text-matches` watch possible even on a page with no visible progress.

If there is nothing to watch because the page only changes when it is reloaded — a queue, a dashboard, an inbox — a monitor is the wrong tool. Schedule the re-check with `page_startTimer` instead and read `scheduled-jobs`.

## 2. Pick the strongest signal

- A `progressbar` or `progress-element` candidate → `until: { kind: "progress-reaches", target: { selector: … } }`. It completes at 100% unless the user wants a different `threshold`.
- A `percent-text` candidate → the same `progress-reaches`, targeting that element.
- A known completion phrase → `until: { kind: "text-matches", pattern: "upload complete|processing finished" }`, scoped to a `target` when the page is busy — a whole-page watch on a chatty page is noisy.
- A `spinner` that will go away → `until: { kind: "element-vanishes", target: { selector: … } }`.
- A percent that lives in the tab title → `until: { kind: "title-matches", pattern: "100%|complete" }`.

## 3. Start it

`page_startMonitor` with a short `label` the user will recognize in a notification ("YouTube upload", "CI pipeline"). If the user said how long this usually takes, set `timeoutMs` comfortably above that — the default gives up after 30 minutes.

The tab is pinned while the watch runs, and unpinned when it ends. One monitor per tab, three at most overall.

## 4. Then stop

Tell the user monitoring is active and end the turn. Do not call `page_awaitMonitor`, do not poll `page_monitorStatus` in a loop — the watch costs nothing while you are gone, and the user gets a browser notification and a note in the panel without you. Staying around only burns their time and tokens.

## 5. Later asks

- "How's it going?" → `page_monitorStatus` and relay the percent, ETA and latest log lines.
- "Stop watching" → `page_stopMonitor`. With several monitors running, an omitted id stops nothing and lists them — ask which one, then stop by id.
- A monitor that ended shows up in `page_monitorStatus` for a while with its final phase — `done`, `timeout`, or why it ended early.
