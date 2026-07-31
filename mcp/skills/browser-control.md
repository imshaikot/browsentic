---
name: browser-control
default: true
description: Drive the open tab — click, type, submit, navigate, and verify the result.
triggers: [click, tap, press, fill, type, enter, submit, form, log in, sign in, search for, navigate, go to, open, scroll, select, choose, button, link, field, checkout, add to cart, screenshot, capture, snapshot, save the page, save a picture]
---

You are acting on the page, not just reading it. Work in a loop: snapshot, target, act, verify.

## 1. Snapshot before you touch anything

Call `page_getPageInfo` first. It returns the page's shape plus an inventory of links, buttons, fields and forms, each with a stable selector already computed. Use those selectors — never invent one from what the page "probably" looks like.

`page_getPageInfo { maxPerKind: 30 }` is the useful default. Drop to `maxPerKind: 1` when you only need the layout diagram and the URL.

## 2. Target by what the user can see

```
page_fillInput    { target: { text: "Email" }, value: "a@b.com" }
page_clickElement { target: { text: "Sign in" } }
```

Visible text survives redesigns that break CSS paths, so prefer it. Fall back to a `selector` from the snapshot when the text is ambiguous or absent. `role` (`"button"`, `"link"`, `"textbox"`) narrows a match and `nth` picks among several, zero-based — but neither can find an element on its own, so one of `selector` or `text` is always required.

## 3. Act, then confirm

After anything that changes the page, check that it landed. `page_waitForElement` for the state you expect next is the direct way; a fresh `page_getPageInfo` works when you are not sure what to expect. A click that silently did nothing looks exactly like a click that worked, until you look.

Navigation has two shapes and they behave differently. `page_navigate` takes **either** a `url` **or** an `action` (`back` / `forward` / `reload`) — never both, never neither. From a tab with no content script the URL must be absolute. The result tells you which path ran: `navigatingTo` pushed a history entry so `back` works afterwards; `navigatedTo` replaced it. `loaded: true` means the load actually finished.

## 4. Typing and forms

`page_fillInput` writes through the native setter and fires the events frameworks listen for, so React and Vue inputs update properly. Set `submit: true` on it, or call `page_pressKey` with Enter, when the form expects a keystroke rather than a button.

`page_submitForm` runs the browser's own validation. It is also the action most likely to send something to someone else, so expect it to be gated — if it comes back declined, say so and stop.

## 5. When something is not there

`TARGET_NOT_FOUND` almost always means the page moved on without you: a menu closed, content loaded late, a modal opened over what you wanted. Re-snapshot rather than retrying the same target. If an element needs to appear first, `page_waitForElement` is cheaper and more reliable than clicking and hoping.

Content behind a hover — dropdowns, tooltips — needs `page_hoverElement` before it exists in the DOM.

## 6. Screenshots

`page_screenshot` captures the tab as an image. By default it captures the **full scroll view** and hands the picture back to you to look at — reach for it when you need to *see* layout or rendering that the text inventory can't convey. Narrow it when asked: `{ fullPage: false }` for just the current viewport, or `{ target: { text: "Pricing" } }` to capture a single element or block.

It writes a file **only when you ask it to.** When the user wants to **save, keep, download, or store** a screenshot, pass `save: true` — the image is written under `~/browsentic/screenshot/` and the result reports the exact path, which you should relay back. Pass `filename` when the user names one; otherwise it is auto-named. Without `save: true` nothing touches the disk, so never tell the user you saved a screenshot unless you actually set `save: true` and got a path back.

## 7. Multi-step tasks

Do the whole task, not the first step of it. If the user says "search for X and open the first result", that is a fill, a submit, a wait, a snapshot, and a click — finish all of it, then report once at the end. Stop early only when you are blocked on something the user must decide.
