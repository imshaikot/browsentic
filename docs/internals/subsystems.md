# Subsystems

The five things that are more than a single action.

---

## Monitors

[`lib/monitor/`](../../lib/monitor/), [`lib/bridge/monitor.ts`](../../lib/bridge/monitor.ts)

Watch a pinned tab in the background for a completion condition — an element appearing or vanishing,
text or title matching a regex, a progress bar reaching a threshold.

| | |
| --- | --- |
| Concurrent | 3 (`MAX_MONITORS`) |
| Duration | 30 minutes default, 4 hours maximum |
| Stall warning | After 2 minutes with no change |
| `page_awaitMonitor` poll | 10 minutes maximum per call |

Percent and ETA are extrapolated from the sample history. Completion fires a browser notification; an
MCP client can also long-poll with `page_awaitMonitor`.

Sampling is debounced and rate-limited, with a **five-second backstop tick** so a page that stops
mutating still gets checked.

The watch lives in the extension, so it survives the agent finishing, the MCP client disconnecting,
and the daemon going away.

---

## Recordings

[`lib/recordings/`](../../lib/recordings/)

The reverse of a monitor: the content script observes what *you* do in one pinned tab — clicks,
fills, selects, keys, submits, scrolls, navigations — and batches the events to the background.

| | |
| --- | --- |
| Duration | 15 minutes (`MAX_RECORDING_MS`), warning at 13 (`WARN_AT_MS`) |
| Events | 2 000 (`MAX_EVENTS`) |
| Steps kept | 80, capped at 12 KB of prompt (`MAX_WORKFLOW_BYTES`) |
| Variables | 20 |

**Scrubbing is unconditional.** Passwords, hidden fields, one-time codes and Luhn-valid card numbers
are dropped whatever the settings. Typed values become `{{placeholders}}` unless "Save what I type"
is on. Captured text, selectors and values are each truncated to a fixed length.

On stop, a one-shot [`task`-mode](guardrails.md#two-spawn-modes) agent call turns the raw trace into
ordered, named steps. That call cannot reach the browser — `{"mcpServers":{}}` is asserted in its
argv.

Recordings live in **extension storage, not on disk**, which is why `browsentic-mcp skills` does not
list them and why `page_listRecordings` / `page_readRecording` exist as tools.

---

## Site maps

[`lib/skills/site-map.ts`](../../lib/skills/site-map.ts),
[`mcp/src/agent/site-map-store.ts`](../../mcp/src/agent/site-map-store.ts)

Generated skills. A mapping run crawls one host read-only under the
[mapping gate](guardrails.md#the-mapping-gate) and finishes by calling `browsentic_saveSiteMap`
exactly once.

The report is validated against per-field size limits, then written to a `.staging/` directory the
skill loader **deliberately cannot read** — an unreviewed map is not merely unused, it is never
opened.

The panel shows the markdown as plain text with the domain it will match. **Activate** commits it;
**Discard** deletes it. An abandoned run's staging is swept.

---

## Files

Attached in the side panel, stored in the extension, and summarised by a one-shot `task`-mode agent
call at attach time.

The agent never opens a file. It sees the notes, plus `page_attachFile { fileId, target }` to put one
into a file input. Upload is `confirm` under the `file-upload` rule.

---

## Screenshots

Full-page mode stitches `captureVisibleTab` tiles, paced by the browser's two-captures-per-second
limit.

Capped at **48 tiles and a 16 384 px canvas side**, reporting `truncated: true` when the page was
taller than the limit rather than silently returning a partial image.

The daemon, not the browser, writes the file — and only when `save: true` was passed or a mapping run
supplied a `saveTo`. See [request-path.md](request-path.md#details-worth-knowing).

---

## Next

**[State on disk →](state.md)**
