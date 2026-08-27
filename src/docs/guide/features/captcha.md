---
layout: layouts/doc.njk
pageKey: docs
title: "Captchas"
seoTitle: "Captchas — Browsentic features"
description: "What Browsentic does at a \"verify you are human\" block, and — more importantly — what it does not. It will tick the checkbox, because that is a click you…"
deck: "What Browsentic does at a \"verify you are human\" block, and — more importantly — what it does not."
docsPath: "guide/features/captcha.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 5
isIndex: false
permalink: "/docs/guide/features/captcha/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/captcha.md"
---
---

## The short version

It will **tick the checkbox**, because that is a click you could have made yourself and it needs a
real browser-level one to land.

It will **not attempt a challenge**. An image grid, an Arkose puzzle, an AWS WAF challenge — those
come back to you with the widget's location, and the run waits.

Ticking the checkbox is [gated for approval](/docs/guide/approvals/) by default, because it acts on
another site's security control.

---

## Why ordinary targeting cannot see a captcha

A captcha is the one thing on a page that `page_getPageInfo` reports nothing about. Vendors build
the widget as a closed shadow root holding a cross-origin iframe holding another shadow root, so
there is no element for `page_clickElement` to aim at, even though you can plainly see the checkbox.

The signs you have hit one: a page that never finishes ("Checking your browser", "Just a moment…"),
a form that refuses without saying why, a visible checkbox no snapshot lists, or a
`TARGET_NOT_FOUND` for something obviously on screen.

---

## The two tools

**`page_findCaptcha`** identifies what is blocking you, reading through the shadow roots and frames
the widget hides in. Read-only — it never clicks anything.

Recognised: Cloudflare Turnstile, reCAPTCHA v2, reCAPTCHA v3, hCaptcha, GeeTest, Arkose FunCaptcha,
AWS WAF Captcha.

**`page_solveCaptcha`** ticks the checkbox with a real browser-level click and waits for the verdict.
Three outcomes:

| State | Meaning |
| --- | --- |
| `solved` | The widget accepted it. Carry on |
| `needsHuman` | The vendor escalated to a challenge a person has to answer. The widget's bounds come back so it can be screenshotted for you; nothing is attempted |
| `invisible` | A scoring captcha with nothing to click — reCAPTCHA v3 and friends |

Chrome only. It shows the debugger bar while it runs.

---

## If it is not a captcha

`CAPTCHA_NOT_FOUND` means there is no known widget on the page, so whatever is blocking the run is
something else — a rate limit, a login wall, a slow request. Worth knowing rather than guessing.

---

## See also

- [reference/tools.md](/docs/reference/tools/) — `page_findCaptcha`, `page_solveCaptcha` parameters
- [Approvals](/docs/guide/approvals/) — the `captcha-solve` rule, and **Always on ‹host›** for a site you use daily
- [Page actions § page_trustedClick](/docs/guide/features/page-actions/) — the same real-click mechanism, for pages that reject synthetic clicks
