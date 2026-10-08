# Instant commands

Browsentic checks every instruction against a local grammar before it reaches the agent. A confident
single-step command such as "go back" runs in the browser in **milliseconds** instead of taking
several seconds through the agent; everything else goes to the agent with your text unchanged.

Commands handled locally carry a **⚡** on the timeline.

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
without a URL.

---

## What always goes to the agent

The grammar leans toward escalating, because the two possible mistakes do not cost the same:

- Escalating something it could have handled costs a round trip.
- Acting on something it misread spends a wrong click on your real page.

So five categories always escalate, however confident the match looks:

| | |
| --- | --- |
| Questions | "is there a login button?" |
| Multi-step phrasing | "and then", "after that" |
| Hedges | "if", "unless", "try to" |
| Anything starting with `@` | An explicit [skill pin](skills.md) |
| Consequential-sounding targets | *buy*, *pay*, *delete*, *send*, *submit*, *confirm* and similar |

A local command that runs and **fails** also escalates instead of reporting the failure.

---

## Logs and routing checks

**Local commands do not appear in `browsentic logs`.** They never reach Browsentic Bridge, so the ⚡
on the timeline is their only record. This is expected.

To see how a single instruction would be routed:

```sh
yarn check:intent "take me to the checkout page"
```

It prints how the grammar scored the text and where it would go.

---

## See also

- [Conversations](conversations.md): the timeline these appear on
- [Skills](skills.md): what happens to everything that escalates
- [internals/agent-runs.md § The intent funnel](../../internals/agent-runs.md#the-intent-funnel): the scoring
