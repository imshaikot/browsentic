---
name: captcha
description: Get past a “verify you are human” block — tick the checkbox, see an image challenge through, hand over only the puzzles nothing can answer.
triggers: [captcha, recaptcha, hcaptcha, turnstile, cloudflare, verify you are human, prove you are human, i am not a robot, checking your browser, just a moment, are you a robot, human verification, challenge, bot check, blocked by, security check]
---

A captcha is the one thing on a page that ordinary targeting cannot reach. The widget sits in a closed shadow root inside a cross-origin iframe, often several frames deep, so `page_clickElement` has nothing to aim at. `page_solveCaptcha` reaches it wherever it is. When a captcha is in the way, getting past it is part of the task — do it, do not stop to report it.

## 1. Notice it — then act at once

`page_getPageInfo` carries a `captcha` field whenever a page holds one that needs answering: the vendor, whether it is already `solved`, and a `next` step. Other signs: a page that never finishes ("Checking your browser", "Just a moment…"), a form that refuses without saying why, a checkbox you can see in a screenshot but no snapshot lists.

**Call `page_solveCaptcha {}` straight away.** Do not look for the checkbox with selectors, do not screenshot it first, do not ask the user whether to try. It is gated for approval, so the user decides there; one yes covers every round of the same captcha in this run. If it comes back `DECLINED`, that is their answer — say so and stop.

If `captcha.solved` is true, the widget is satisfied already — carry on with the task.

## 2. Read the state it returns

- **`solved`** — done. Re-snapshot and continue the task; a form may now need submitting.
- **`challenge`** — an image challenge is open and waiting on you. §3.
- **`pending`** — the widget took the click but had not settled. Wait a few seconds, then `page_findCaptcha {}` to re-check; call `page_solveCaptcha {}` again only if it is back to `idle`.
- **`invisible`** — a scoring captcha (reCAPTCHA v3 and the like) with nothing to click. If the page still refuses you, the site has judged the session; say so and stop.
- **`needsHuman`** — a puzzle Browsentic does not answer (Arkose, AWS WAF, a drag-to-fit). §4.
- **`CAPTCHA_NOT_FOUND`** — no captcha on the page, so the block is something else.

## 3. An image challenge

Browsentic's own vision analyst answers reCAPTCHA and hCaptcha challenges inside the call — a fresh one-shot session per round, stopped as soon as it has answered — so most of the time `page_solveCaptcha {}` returns `solved` without you seeing a grid. When it cannot finish, the result has state `challenge`, a note saying so, and the challenge as an **image** beside its description. Answer it yourself:

- **`kind: "tiles"`** — a grid with each tile's number painted in its corner (1 top-left, counting along each row). Call `page_solveCaptcha {"tiles": [...]}` with every tile that matches `prompt`. It is the whole selection, not a change to it; `[]` means none match. When `dynamic` is true, each tile you pick is swapped for a new picture and the result comes back with the grid again — keep answering; `[]` verifies it once no tile matches. For a 4×4 slice of one photo, include every tile showing any part of the object.
- **`kind: "points"`** — a picture to tap on. Call `page_solveCaptcha {"points": [{"x": …, "y": …}]}` with pixel positions on that image (it is `imageWidth` × `imageHeight`), aiming for the centre of each thing to tap.
- **Cannot make it out?** `page_solveCaptcha {"reload": true}` swaps it for another.

Repeat with each new result until `solved`. `errors` on a result means the last answer was refused — look again more carefully. Vendors often want several rounds; that is normal, not a failure.

## 4. When it needs the user

`needsHuman` is the one case to hand over. `page_screenshot {}` to see it, tell the user plainly this one needs them and that they can solve it in the browser window in front of them, then poll `page_findCaptcha {}` every several seconds until `solved` and carry on. If they have not solved it after a reasonable while, say you are still waiting rather than looping in silence.

## 5. When the tools cannot run

`DEBUGGER_UNAVAILABLE` means Chrome's debugger could not attach — almost always DevTools open on that tab. Ask the user to close DevTools, then retry.

A Firefox build has neither tool; if they are not in your list, ask the user to solve the captcha themselves. `UNSUPPORTED` means the same when an older instruction names them.
