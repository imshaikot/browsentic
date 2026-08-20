# Recordings

Show it once, repeat it later.

A [site map](site-maps.md) teaches Browsentic what a site **is**. A recording teaches it what **you
do** there.

---

## Recording

Press **Record** in the side panel's **Recordings** tab, do the job yourself — click through the
pages, fill the fields, submit the form — and press stop. Or say it:

```
record my browsing session
stop recording
```

Both of those are [instant commands](instant-commands.md), and recording only ever starts from your
own click or your own words.

Browsentic splits what you did into ordered steps, names them after what you accomplished, and keeps
them in a renameable list.

A recording **follows the tab it started in and nothing else**. Navigations inside that tab become
steps, other tabs are ignored, and closing the tab stops and saves. It runs for at most **15
minutes**, warns you at 13, and stops itself at the limit.

---

## What you type is not saved by default

Every field becomes a placeholder — `{{email}}`, `{{invoice_number}}` — and the assistant asks you
for the value when it replays.

Tick **Save what I type** to keep literal values instead. Either way, **passwords, hidden fields,
one-time codes and anything shaped like a card number are dropped unconditionally.**

---

## Replaying

```
do it like last time
```

This is not blind playback. The steps are a plan, not a script:

- the agent re-checks each target against the live page before acting;
- it prefers the **visible text** it recorded over the CSS selector, because selectors are what a
  redesign breaks first;
- anything consequential still waits for [approval](../approvals.md), even though you performed it
  yourself while recording;
- if a step no longer lands, the run **stops and tells you which one** rather than improvising a
  different route to the same effect.

If two recordings could plausibly match what you asked for, you will be asked which — never guessed
between, because replaying the wrong workflow spends real clicks on your real account.

---

## Where they live

In the extension's own storage, not on disk. That is why `browsentic-mcp skills` does not list them,
and why `page_listRecordings` and `page_readRecording` exist as tools.

Removing the extension removes them.

The one time a recording leaves the browser is the local, one-shot call that turns the raw trace
into named steps.

---

## See also

- [Site maps](site-maps.md) — the other kind of memory
- [Skills](skills.md) — `browse-navigation` is the skill that replays these
- [internals/subsystems.md](../../internals/subsystems.md) — capture, scrubbing and step synthesis
