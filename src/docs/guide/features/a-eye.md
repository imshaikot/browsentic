---
layout: layouts/doc.njk
pageKey: docs
title: "A-Eye"
seoTitle: "A-Eye — Browsentic features"
description: "Pointing at what you mean, instead of describing it. Click the A-Eye button — the lens in the side panel's composer row. Your cursor becomes a lens, and…"
deck: "Pointing at what you mean, instead of describing it."
docsPath: "guide/features/a-eye.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 12
isIndex: false
permalink: "/docs/guide/features/a-eye/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/a-eye.md"
---
---

## Pointing at something

Click the **A-Eye** button — the lens in the side panel's composer row. Your cursor becomes a lens,
and whatever you hover on the page is outlined as you move. Click to pick it. `↑` widens the pick to
the parent element when you land inside something smaller than you meant; `Esc` cancels.

The pick appears as a chip above the composer, and it goes out with your **next message** — the
element's tag, its role, its selector and the text it held at that moment. The chip clears when the
message sends, so one pick scopes one message. The `×` on the chip drops it without sending.

The site never sees the pick. Every pointer event in the sequence is stopped before the page gets it
and the click itself is cancelled, so picking a "Delete" button picks it rather than pressing it.

## What the agent does with it

The element arrives in the run's system prompt as the **subject of the instruction**. Ask "what does
this say?" and the answer is about that element; say "translate this" and only that gets translated.
It re-reads the element live before acting on it, because a page can change between your pick and
its first tool call.

Words win over the pick when they clearly point elsewhere. "Now go to checkout" has left the element
behind; "compare this with the one below" is about two. The pick resolves ambiguity — it does not
override you.

If the element is gone by the time the agent looks, it says so rather than acting on whatever is
nearest. You picked that one on purpose.

## It can ask you to point, too

`page_pickElement` is the same lens, opened from the other side. When a target is genuinely
ambiguous — three rows share a label, "the second one" could mean two things — the agent can hand
the page back to you with a one-line question over it, and carry on with whatever you click.

It stops everything and waits for a person, so it is the most expensive tool in the set and the
[`a-eye` skill](/docs/guide/features/skills/) tells the agent to reach for it rarely. Dismiss it with `Esc` and the
agent is told to ask in words instead, not to ask you to point again.

## Edges

- **One tab.** The lens opens on the tab that was in front when you pressed the button. Switching
  tabs mid-pick leaves it behind on the old one; it times out after a minute.
- **Top frame only.** An element inside an iframe picks the iframe, not what is in it.
- **Text, not pixels.** A pick carries the element's rendered text, not an image of it. For layout
  or rendering, ask for a [screenshot](/docs/guide/features/screenshots/) as well.
- **Long elements are cut.** Picking a whole article sends the first couple of thousand characters;
  the agent reads the rest through `page_extractText` scoped to the selector.

---

## See also

- [reference/tools.md § page_pickElement](/docs/reference/tools/#page-pickelement) — parameters
- [Conversations](/docs/guide/features/conversations/) — what else rides along with a message
- [Skills](/docs/guide/features/skills/) — how the `a-eye` skill gets routed
