---
layout: layouts/doc.njk
pageKey: docs
title: "Recordings"
seoTitle: "Recordings — Browsentic features"
description: "Show it once, repeat it later. A site map teaches Browsentic what a site is. A recording teaches it what you do there."
deck: "Show it once, repeat it later."
docsPath: "guide/features/recordings.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 9
isIndex: false
permalink: "/docs/guide/features/recordings/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/recordings.md"
---
A [site map](/docs/guide/features/site-maps/) teaches Browsentic what a site **is**. A recording teaches it what **you
do** there.

---

## Recording

Press **Record** in the side panel's **Recordings** tab, do the job yourself — click through the
pages, fill the fields, submit the form — and press stop. Or say it:

```
record my browsing session
stop recording
```

Both of those are [instant commands](/docs/guide/features/instant-commands/), and recording only ever starts from your
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
- anything consequential still waits for [approval](/docs/guide/approvals/), even though you performed it
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

- [Site maps](/docs/guide/features/site-maps/) — the other kind of memory
- [Skills](/docs/guide/features/skills/) — `browse-navigation` is the skill that replays these
- [internals/subsystems.md](/docs/internals/subsystems/) — capture, scrubbing and step synthesis
