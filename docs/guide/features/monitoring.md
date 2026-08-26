# Background monitoring

Long jobs — an upload, a build, a deploy — do not need an agent sitting on them burning tokens on
"is it done yet".

```
watch this upload and tell me when it's done
```

---

## What happens

Browsentic finds the progress signal, pins the tab, and watches it **in the background while you
work elsewhere**. It tracks percent, extrapolates an ETA from the sample history, notices when
progress has stalled, and notifies you on completion.

The watch runs in the extension. It needs no further tool calls, and it keeps running even if the
agent finishes, the MCP client disconnects, or the daemon goes away.

---

## What it can watch for

| Condition | Completes when |
| --- | --- |
| `element-appears` | An element shows up |
| `element-vanishes` | An element goes away — a spinner, usually |
| `text-matches` | Page text matches a regular expression |
| `title-matches` | The tab title matches one |
| `progress-reaches` | A progress bar hits a threshold (100 by default) |

`page_findProgress` is what picks the signal: it scans for progress bars with their current percent,
percent readouts in text, spinners and busy regions, each with a selector. If it comes back empty,
the page shows nothing measurable — and you will be asked what completion looks like rather than
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
mutating still gets checked.

---

## Stopping one

```
stop monitoring
```

That is an [instant command](instant-commands.md) — it ends the watch without waking an agent at
all. The tab is unpinned again and no notification is shown, since the stop was asked for.

---

## From an MCP client

`page_awaitMonitor` long-polls a monitor to completion. A reply with `settled: false` means the poll
window passed while the watch continues — **call again**; that is normal, not an error. If the call
fails with `EXTENSION_OFFLINE`, the monitor is still running in the browser: reconnect and call
again.

---

## See also

- [reference/tools.md § Monitoring](../../reference/tools.md#monitoring) — every parameter
- [Scheduling](scheduling.md) — when the page shows nothing to watch and the job must be re-done
- [Skills](skills.md) — the `monitor-progress` skill routes these requests
- [internals/subsystems.md](../../internals/subsystems.md) — how sampling actually works
