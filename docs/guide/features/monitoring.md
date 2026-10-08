# Background monitoring

A monitor watches a long job in a tab, such as an upload, a build or a deploy, and notifies you when
it finishes. The browser does the watching, so no agent spends tokens asking whether the job is done.

```
watch this upload and tell me when it's done
```

---

## How a monitor runs

Browsentic finds the progress signal, pins the tab, and watches it **in the background while you
work elsewhere**. It tracks the percentage, extrapolates an ETA from the sample history, notices when
progress has stalled, and notifies you on completion.

The watch runs in the browser, in the extension. It needs no further tool calls, and it keeps
running if the agent finishes, the MCP client disconnects, or Browsentic Bridge goes away.

---

## What it can watch for

| Condition | Completes when |
| --- | --- |
| `element-appears` | An element shows up |
| `element-vanishes` | An element goes away, usually a spinner |
| `text-matches` | Page text matches a regular expression |
| `title-matches` | The tab title matches one |
| `progress-reaches` | A progress bar hits a threshold (100 by default) |

`page_findProgress` picks the signal. It scans for progress bars with their current percentage,
percentage readouts in text, spinners and busy regions, each with a selector. If it finds nothing,
the page shows nothing measurable, and you are asked what completion looks like instead of being
given a watch on nothing.

---

## Limits

| | |
| --- | --- |
| Concurrent monitors | 3 |
| Default duration | 30 minutes |
| Maximum duration | 4 hours |
| While it runs | The tab is pinned; you can work anywhere else |
| On completion | A browser notification, plus the run's own report |

Sampling is debounced and rate-limited, with a five-second backstop tick so a page that stops
changing still gets checked.

---

## Stopping one

```
stop monitoring
```

This is an [instant command](instant-commands.md): it ends the watch without starting an agent. The
tab is unpinned and no notification is shown, since you asked for the stop.

---

## From an MCP client

Over the optional MCP endpoint, `page_awaitMonitor` long-polls a monitor until it completes. A reply
with `settled: false` means the poll window ended while the watch continues: **call again**. That is
normal, not an error. If the call fails with `EXTENSION_OFFLINE`, the monitor is still running in
the browser: reconnect and call again.

---

## See also

- [reference/tools.md § Monitoring](../../reference/tools.md#monitoring): every parameter
- [Scheduling](scheduling.md): when the page shows nothing to watch and the job must be re-done
- [Skills](skills.md): the `monitor-progress` skill routes these requests
- [internals/subsystems.md](../../internals/subsystems.md): how sampling works
