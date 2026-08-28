---
name: a-eye
description: Let the user point at the element they mean, and work on what they pointed at.
triggers: [a-eye, aeye, point at, point to, let me show you, show you which, which one do you mean, i'll point, let me pick, pick it myself]
---

A-Eye is pointing, in both directions. The user can point at an element before they type, and you can ask them to point when words are not enough. Either way one element becomes the subject of the work.

## When they pointed first

If they used A-Eye before sending, the element is already in your system prompt under **Focused element (A-Eye)** — its selector, its tag and role, and the text it held at that moment. There is nothing to call: it is the subject of the instruction.

Three habits make that worth something:

1. **Re-read it before you act on it.** `page_extractText { target: { selector } }` with the selector from that block gets the live element. The text in the prompt is a snapshot from when they pointed, and pages move. For a question you can answer from the snapshot alone, answering is fine — say what you are answering from if it matters.
2. **Stay inside it.** Scope reads to that `target` rather than pulling the whole page. If the answer genuinely is not in the element, look further and *say* that you did — do not quietly widen the scope and answer as if they had asked about the page.
3. **Follow the words when they lead away.** "Compare this with the one below it" is about two elements; "now go to checkout" has left the element behind entirely. The focus scopes an ambiguous instruction, it does not override an explicit one.

If the selector no longer resolves, the page has changed under the pick. Say so and ask them to point again — never fall back to whatever element looks similar, because the whole point of the pick was that they chose that one.

## When you need them to point

`page_pickElement {}` hands the page to the user: their cursor becomes a lens, whatever they hover is outlined, and the element they click comes back with its selector, its role and its rendered text.

```
page_pickElement { hint: "Point at the price you mean" }
```

Reach for it when a target is genuinely ambiguous and describing it would take longer than pointing — several rows share a label, "the second one" could mean two things, the user said "this one" about something you cannot see. Set `hint` to the question you would have asked in words.

It stops everything and waits for a person, so it costs more than any other tool here. Do not call it to explore a page, do not call it when `page_getPageInfo` would have told you the same thing, and never call it twice in a row — if the first pick did not tell you what you needed, ask in words.

Two refusals, both terminal: `PICK_CANCELLED` means they dismissed it without choosing, and `TIMEOUT` means they never got to it. Both mean the same thing — stop asking them to point, and carry on in words or ask a plain question.

## Reporting

Name what you worked on. "The Standard plan card lists £29/month" tells them you were on the element they picked; "£29/month" leaves them checking. One clause is enough — do not describe the element back to them at length. They chose it; they know what it is.
