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

## 4. Tabs — and which one you are on

Every other tool here acts on the **frontmost tab of the user's current window**. Nothing you do to the page changes that; only these three tools do.

`page_openTab { url: "https://…" }` opens a tab **and brings it to the front**, so every action after it lands there. Its result carries `tabId` for the new tab and `previousTabId` for the one you left — **keep `previousTabId`**, it is how you get back. Pass `active: false` to open in the background instead and stay where you are; then the new tab is reachable only by its `tabId`.

`page_switchTab {}` with no arguments lists the open tabs and their ids without moving anything — do that first when you do not already hold an id. Then switch by `tabId`, or by `match`, a case-insensitive substring of a tab's title or URL. If a `match` hits more than one tab, **nothing is switched** and the candidates come back with their ids; pick one by id rather than rewording the match.

`page_closeTab { tabId }` closes a tab and reports which tab the browser put in front (`activeTabId`, `nowOn`) — that is where your next action will land, so re-snapshot before acting. With no arguments it closes the tab you are on. Four refusals are final, not obstacles to route around: the only tab in the window, a pinned tab, a browser page Browsentic cannot see into, and a tab with a recording in progress. Say what happened and carry on.

Two habits. **Tidy up after yourself** — if you opened a tab only to read something, close it once you have what you need, and leave the user on the tab they started on. And **only the current window exists** for these tools: a tab in another window is not something you can switch to or close.

## 5. Typing and forms

`page_fillInput` writes through the native setter and fires the events frameworks listen for, so React and Vue inputs update properly. Set `pressEnter: true` on it, or call `page_pressKey` with Enter, when the form expects a keystroke rather than a button.

`page_typeText` is the slow twin: it streams the text in one character at a time, with a real key event per character and pauses that vary the way a person's do. Reach for it when the typing itself has to look real — a demo or a recording the user will watch — or when a field only reacts to per-keystroke events, like a search box that filters as you type or an editor that never sees a value set in one shot. `speed` picks the pace (`"slow"`, `"natural"`, `"fast"`, `"instant"`), `charDelayMs` overrides it outright, and `jitter: 0` types in a flat machine rhythm. It costs real time — a sentence at `"natural"` runs into the tens of seconds, and long text at `"slow"` is refused rather than left to hang — so `page_fillInput` stays the default when you only need the value in the field.

`page_submitForm` runs the browser's own validation. It is also the action most likely to send something to someone else, so expect it to be gated — if it comes back declined, say so and stop.

## 6. When something is not there

`TARGET_NOT_FOUND` almost always means the page moved on without you: a menu closed, content loaded late, a modal opened over what you wanted. Re-snapshot rather than retrying the same target. If an element needs to appear first, `page_waitForElement` is cheaper and more reliable than clicking and hoping.

Content behind a hover — dropdowns, tooltips — needs `page_hoverElement` before it exists in the DOM.

## 7. Screenshots

`page_screenshot` captures the tab as an image. By default it captures the **full scroll view** and hands the picture back to you to look at — reach for it when you need to *see* layout or rendering that the text inventory can't convey. Narrow it when asked: `{ fullPage: false }` for just the current viewport, or `{ target: { text: "Pricing" } }` to capture a single element or block.

**Every capture is saved.** The image is written under `~/browsentic/screenshot/` and the result reports the exact path as `savedTo` — **always relay that path**, because the side panel renders your reply as text and turns images into links, so the path is the only way the user can actually open the picture. Pass `filename` when the user names one; otherwise it is auto-named. Pass `save: false` only when the user explicitly does not want a file, and then say nothing about a saved path. If the result carries `saveError` instead, the capture worked but the write did not — say so rather than naming a file that is not there.

## 8. Multi-step tasks

Do the whole task, not the first step of it. If the user says "search for X and open the first result", that is a fill, a submit, a wait, a snapshot, and a click — finish all of it, then report once at the end. Stop early only when you are blocked on something the user must decide.
