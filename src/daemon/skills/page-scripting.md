---
name: page-scripting
description: Install a reviewed JavaScript toolkit in the page and call it repeatedly — for batch work and capabilities no tool covers.
triggers: [each, every, all of them, for all, bulk, batch, repeat, again for, 20, dozens, one by one, tags, rows, entries, items, seek, fast forward, rewind, playback, canvas, video position, inject, script, run code]
---

The user has turned the **Live tool** switch on for this message. That is what makes these two tools available at all, and it is a deliberate act on their part — they are telling you that writing a small script is a reasonable thing to consider here. It is not an instruction to write one: if the ordinary tools fit, use them.

`page_injectCode` installs a small toolkit of functions in the page after the user approves the code, and `page_runCode` calls one of them with fresh arguments — no further prompts, as many times as the job needs.

## When to reach for it — and when not to

Reach for it in exactly two situations:

1. **The same steps, three or more times, only the input changing.** Creating 20 tags, archiving every message, renaming a list of files. Ten clicks per item times twenty items is two hundred round trips; one injected `addTag(name)` is one approval and twenty cheap calls.
2. **A capability no tool covers.** Seeking a video to a timestamp, reading pixels off a canvas, driving an editor's own JavaScript API. If you find yourself simulating something the page could do in one line of its own code, write that line.

Do **not** reach for it when the ordinary tools already fit. A one-off click is `page_clickElement`; two repetitions are still cheaper done directly than approved, installed and called. Reading data out of a page is `page_extractText` or `page_getPageInfo`. The injected path costs a user interruption (the approval), a visible "Browsentic is debugging this browser" bar on every call, and it does not work on Firefox or on a tab with DevTools open — so it has to earn its place.

The moment to decide is the moment you notice the repetition: after doing a task once by hand and seeing the same sequence coming again and again, stop and write the function rather than grinding through the loop.

## Writing the toolkit

Your code runs once, in the page's main world, after the user approves it. Assign every entry point onto the `tools` object you are given:

```js
tools.addTag = async (name) => {
  document.querySelector('#new-tag').value = name;
  document.querySelector('#new-tag').dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('form.tag-form button[type=submit]').click();
  await new Promise((done) => setTimeout(done, 400));
  return [...document.querySelectorAll('.tag-row .name')].some((el) => el.textContent === name);
};
```

Rules that keep it working:

- **Data goes in arguments, never in the code.** The user approves the code once; if a value is baked in, changing it means another approval. `tags.forEach` loops belong in your calls to `page_runCode`, not inside the toolkit.
- **Secrets never go in the code.** The approval prompt shows every character to the user, and a credential does not belong on that screen. Fill credential fields with `page_fillInput`, which handles sealed secrets properly.
- **Return JSON, and return proof.** A function that acted should return evidence it worked — the created item's name, the new count — so each `page_runCode` result verifies itself. `undefined` teaches you nothing.
- **Snapshot first.** Build selectors from a fresh `page_getPageInfo`, exactly as you would for a click. Guessed selectors fail after approval, which wastes the user's attention twice.
- **Write an honest `purpose`.** The one-line purpose is what the user reads before the code; say what it does in their words ("Create GA tags one by one from a list"), not in yours.

## The lifecycle

`page_injectCode { purpose, code, call? }` triggers the approval — the user can press **Review** and read the code before deciding. Pass `call` to run the first invocation in the same round trip. Then `page_runCode { function, args }` per item. The toolkit survives page reloads (the approved code is re-installed silently) but is bound to the tab and site it was approved on: navigate to another origin and calls refuse with `TOOLKIT_SCOPE` — inject again there if the job follows.

If the approval comes back declined, that is an answer, not an obstacle: fall back to the ordinary tools or ask, never re-submit the same code hoping for a different click. A `CODE_ERROR` result carries the page-side exception — fix the code and inject the corrected version, which is a new approval, so get it right in as few revisions as you can.

`LIVE_TOOLS_OFF` means the switch went off between messages. Only the user can turn it back on; say what you would use it for and why, and carry on with the ordinary tools meanwhile.
