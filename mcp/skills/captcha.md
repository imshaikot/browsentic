---
name: captcha
description: Get past a “verify you are human” block — read what the widget is, tick its checkbox, hand a real challenge to the user.
triggers: [captcha, recaptcha, hcaptcha, turnstile, cloudflare, verify you are human, prove you are human, i am not a robot, checking your browser, just a moment, are you a robot, human verification, challenge, bot check, blocked by, security check]
---

A captcha is the one thing on a page that ordinary targeting cannot see. Vendors build the widget as a closed shadow root holding a cross-origin iframe holding another shadow root, so `page_getPageInfo` reports nothing where the checkbox visibly is, and `page_clickElement` has no element to aim at. Two tools read through that; nothing else on the page changes how you work.

## 1. Notice you are blocked

The signs are a page that never finishes ("Checking your browser", "Just a moment…"), a form that refuses without saying why, a visible checkbox no snapshot lists, or a `TARGET_NOT_FOUND` for something you can plainly see in a screenshot. Any of those, stop guessing selectors and call `page_findCaptcha {}`.

Do not call it speculatively on every page. It attaches Chrome's debugger for a moment, which flashes the "Browsentic is debugging this browser" bar at the user, so it earns its place only once something is actually stuck.

## 2. Read it before you touch it

`page_findCaptcha` never clicks. It reports `vendor` and `label` (Cloudflare Turnstile, reCAPTCHA v2/v3, hCaptcha, GeeTest, Arkose, AWS WAF), the widget's on-screen `bounds`, a viewport `point` for its checkbox when it has one, and a `state`:

- **`solved`** — already satisfied. The block is something else; re-snapshot and carry on.
- **`idle`** — a checkbox is waiting. This is the case §3 handles.
- **`invisible`** — a scoring captcha like reCAPTCHA v3. **There is nothing to click and nothing to wait for.** If the page still refuses you, the site has judged the session, and no amount of retrying changes that — say so and stop.
- **`needsHuman`** — a challenge a person has to answer. Go to §4.
- **`found: false`** — no captcha here at all, so whatever is blocking you is a different problem.

## 3. Tick the checkbox

`page_solveCaptcha {}` finds the widget, clicks its checkbox with a real browser-level mouse event, and waits for the verdict. A synthetic click cannot do this: the checkbox only reacts to genuine pointer input, which is the whole point of it.

It is gated for approval, because ticking a site's human check is the user's call rather than yours. **If it comes back `DECLINED`, that is an answer — say so and stop, do not look for another way through.**

Read `state` on the result the same way as in §2. `pending` means the widget took the click but had not settled inside the wait; call `page_findCaptcha {}` again a few seconds later rather than clicking twice. Raise `waitMs` when a site is habitually slow.

## 4. When it needs the user, hand it over

`needsHuman` means the vendor escalated to an image grid, a puzzle, or a slider — Arkose and AWS WAF do this every time, reCAPTCHA and hCaptcha do it when they are suspicious. **Do not attempt the challenge.** It is a test that a person is present, you are not one, and answering it is not a capability you have.

What to do instead, in order: `page_screenshot {}` so you can see the challenge and describe it, then tell the user plainly that this one needs them and that they can solve it in the browser window already in front of them. Do not pass `save: true` — they are looking at the real thing, and a file of it helps nobody. Then wait: poll `page_findCaptcha {}` every several seconds until `state` becomes `solved`, and continue the task from there. If they do not solve it within a reasonable spell, report that you are still waiting rather than looping forever in silence.

The user is sitting at this browser. Handing them ten seconds of clicking is a normal step in a task, not a failure to report apologetically.

## 5. When the tools cannot run

`DEBUGGER_UNAVAILABLE` means Chrome's debugger could not attach — almost always DevTools being open on that tab. Tell the user to close DevTools and retry; there is no fallback, because reading a closed shadow root is exactly what the debugger is for.

`UNSUPPORTED` means Firefox, which does not expose a debugger to extensions. Neither tool works there. Say so and ask the user to deal with the captcha themselves.

Both are terminal conditions. Report them and move on to whatever else the task needs.
