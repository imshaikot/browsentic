---
layout: layouts/doc.njk
pageKey: docs
title: "Instant commands"
seoTitle: "Instant commands — Browsentic features"
description: "Some things should not cost a round trip to a language model. Sending \"go back\" out to an agent costs several seconds to arrive at something the extension…"
deck: "Some things should not cost a round trip to a language model."
docsPath: "guide/features/instant-commands.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 1
isIndex: false
permalink: "/docs/guide/features/instant-commands/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/instant-commands.md"
---
Sending "go back" out to an agent costs several seconds to arrive at something the extension could
have done immediately. So every instruction is scored against a local grammar first. Confident
single-step commands run in the browser in **milliseconds** and stop there. Everything else goes to
the agent with your text untouched.

Locally-handled commands carry a **⚡** on the timeline.

---

## What runs locally

| Runs locally | Goes to the agent |
| --- | --- |
| back, forward, reload | "is there a login button?" |
| open github.com, open localhost:3000 | "open the settings menu" |
| open github.com in a new tab | "close this tab", "switch to my gmail tab" |
| google something, search the web for something | "search for wireless headphones" |
| scroll up, down, top, bottom, page down | "scroll down and tell me what it says" |
| press enter, hit escape, press arrow down | "click sign in and then fill in my email" |
| click Sign in, tap Continue | "click Buy now", "click it" |
| record my browsing session, stop recording | "record a video of this page" |
| stop monitoring | "stop watching and tell me what happened" |

Common site names are known, so "open gmail", "open hacker news" and "open stack overflow" resolve
without you typing a URL.

---

## Why the split falls where it does

The bias is toward escalating, because the two mistakes are not symmetric:

- Escalating something it could have handled costs a round trip.
- Acting on something it misread spends a wrong click on your real page.

So five categories escalate unconditionally, regardless of how confident the match looks:

| | |
| --- | --- |
| Questions | "is there a login button?" |
| Multi-step phrasing | "and then", "after that" |
| Hedges | "if", "unless", "try to" |
| Anything starting with `@` | An explicit [skill pin](/docs/guide/features/skills/) |
| Consequential-sounding targets | *buy*, *pay*, *delete*, *send*, *submit*, *confirm* and friends |

A local command that runs and **fails** also escalates, rather than reporting the failure.

---

## Two things this explains

**Local commands leave no trace in `browsentic logs`.** They never reach the daemon. That is
expected, not a bug — the ⚡ is where they show up.

**Explaining any single routing decision:**

```sh
yarn check:intent "take me to the checkout page"
```

That prints how the grammar scored it and where it would go.

---

## See also

- [Conversations](/docs/guide/features/conversations/) — the timeline these appear on
- [Skills](/docs/guide/features/skills/) — what happens to everything that escalates
- [internals/agent-runs.md § The intent funnel](/docs/internals/agent-runs/#the-intent-funnel) — the scoring
