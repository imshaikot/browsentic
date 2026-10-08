# A-Eye

A-Eye lets you click an element on the page to make it the subject of your next message, and lets
the agent ask you to point when it cannot tell which element you mean.

---

## Pointing at something

Click the **A-Eye** button (the lens in the side panel's composer row). Your cursor becomes a lens
and outlines whatever you hover. Click to pick it. `↑` widens the pick to the parent element when you
land inside something smaller than you meant; `Esc` cancels.

The pick shows as a chip above the composer, with a small thumbnail, and goes out with your **next
message**: the element's tag, role and selector, the text it held at that moment, and a photograph
of it as you saw it. The chip clears when the message sends, so one pick scopes one message. The
chip's `×` drops it without sending.

The site never sees the pick. Every pointer event in the sequence is stopped before the page gets it
and the click itself is cancelled, so picking a "Delete" button does not press it.

## What the agent does with it

The element arrives in the run's system prompt as the **subject of the instruction**. Ask "what does
this say?" and the answer is about that element; say "translate this" and only that is translated.
The agent re-reads the element live before acting on it, because the page can change between your
pick and its first tool call. When appearance matters, it can view the photograph taken when you
picked, even if the page has changed since.

Your words win when they clearly point elsewhere: "now go to checkout" has left the element behind,
and "compare this with the one below" is about two elements. The pick resolves ambiguity; it does not
override what you say.

If the element is gone by the time the agent looks, it says so instead of acting on whatever is
nearest.

## When the agent asks you to point

`page_pickElement` opens the same lens from the agent's side. When a target is ambiguous (three rows
share a label, or "the second one" could mean two things), the agent can hand the page back to you
with a one-line question over it, and continue with whatever you click.

It stops the run and waits for a person, so it is the most expensive tool in the set, and the
[`a-eye` skill](skills.md) tells the agent to use it rarely. Dismiss it with `Esc` and the agent is
told to ask in words instead of asking you to point again.

## Edges

- **One tab.** The lens opens on the tab that was in front when you pressed the button. Switching
  tabs mid-pick leaves it on the old tab; it times out after a minute.
- **One lens at a time.** Starting a new pick, from the button or from the agent, dismisses a lens
  already waiting, and whoever opened that one is told it was cancelled.
- **Top frame only.** An element inside an iframe picks the iframe, not what is in it.
- **Never Browsentic's own.** The [hands-free](hands-free.md) mic, the minimized rail and
  Browsentic's cards are skipped: the lens draws nothing over them, and a click on one picks
  nothing. A pick started from the hands-free mic's menu moves the mic aside until it is done.
- **The element, not the page.** The photograph covers what you picked plus a small margin. For the
  page around it, ask for a [screenshot](screenshots.md) as well.
- **Long elements are cut.** Picking a whole article sends the first couple of thousand characters;
  the agent reads the rest with `page_extractText` scoped to the selector.

---

## See also

- [reference/tools.md § page_pickElement](../../reference/tools.md#page_pickelement): parameters
- [Conversations](conversations.md): what else goes out with a message
- [Skills](skills.md): how the `a-eye` skill is routed
