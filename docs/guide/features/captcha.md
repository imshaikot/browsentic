# Captchas

How Browsentic handles a captcha: which widgets it detects, which it answers itself, and which it
hands back to you.

https://github.com/user-attachments/assets/7818f665-be35-4fa3-84cc-32100880b7ee

---

## The short version

It **ticks the checkbox** with a real browser-level click, and it **answers image challenges**:
each round, a short-lived vision session looks at the grid, answers, and is closed. Only the puzzles
it cannot read (Arkose, AWS WAF, drag-to-fit) come back to you.

It finds the widget wherever the page put it: inside closed shadow roots, cross-origin iframes, and
frames nested within frames.

Answering a captcha is [gated for approval](../approvals.md) by default, because it acts on another
site's security control. One approval covers every round of that captcha in the same run.

---

## How the agent knows there is one

`page_getPageInfo` carries a `captcha` field whenever the page holds a captcha that needs answering:
the vendor, whether it is already `solved`, and the next step. It is read without Chrome's debugger,
from every frame the browser knows of, so it costs nothing on pages without a captcha and is absent
there. Invisible scoring captchas (reCAPTCHA v3 and the like) are left out, because there is nothing
to answer.

When the agent sees that field it calls `page_solveCaptcha` straight away, instead of hunting for a
checkbox no selector can reach.

---

## The two tools

**`page_findCaptcha`** reports what is there without touching it: the vendor, how many frames deep
it sits, its on-screen bounds, whether it is satisfied and, while a challenge is open, its prompt and
grid.

Recognised: Cloudflare Turnstile (including the full-page interstitial), reCAPTCHA v2 and v3,
hCaptcha, GeeTest, Arkose FunCaptcha, AWS WAF Captcha.

**`page_solveCaptcha`** answers it:

1. Finds the widget and waits out one that is still loading (Turnstile's "Verifying…").
2. Scrolls it into view if it is below the fold, and ticks the checkbox.
3. If the vendor responds with an image challenge, answers it round by round until the widget is
   satisfied.

| State | Meaning |
| --- | --- |
| `solved` | The widget accepted it. Carry on |
| `challenge` | An image challenge is still open. The result carries it as an image for the caller to answer |
| `pending` | The widget took the click but had not settled inside the wait |
| `needsHuman` | A puzzle Browsentic does not answer. Its bounds come back so it can be shown to you |
| `invisible` | A scoring captcha with nothing to click |

Chrome only. It shows the debugger bar while it runs.

---

## Image challenges

The extension photographs the challenge and hands it to the Bridge, which starts a one-shot session
of your configured agent to look at that single picture. The session answers and is stopped at once;
nothing carries over to the next round. Back in the page, the answer is clicked with real pointer
movement, the challenge's own button is pressed, and whatever comes next is photographed.

Two kinds are answered:

- **Tile grids**: reCAPTCHA's 3×3 and 4×4, including the "click verify once there are none left"
  grids that replace each picked tile with a new picture. Each tile's number is painted on the
  photograph, which is taken only once every tile has finished fading in.
- **Pictures to tap**: hCaptcha's canvas challenges ("click the animal icon that is different").
  The answer is a set of points on the photograph.

The analyst needs an agent that can read images; today that is Claude Code, Codex or Cursor CLI.
With another agent, or when the analyst gives up (ten rounds, or the time budget), the result comes
back as `state: "challenge"` with the picture attached, and the agent driving the run answers it
itself by calling `page_solveCaptcha` again with `tiles`, `points` or `reload`.

A vendor can keep setting new challenges to a browser it distrusts, especially an automated or
headless one, however well each round is answered. That is the vendor's verdict on the browser, not
a wrong answer.

---

## If it is not a captcha

`CAPTCHA_NOT_FOUND` means there is no known widget on the page, in any frame, so whatever is
blocking the run is something else: a rate limit, a login wall, a slow request.

---

## See also

- [reference/tools.md](../../reference/tools.md): `page_findCaptcha` and `page_solveCaptcha` parameters
- [Approvals](../approvals.md): the `captcha-solve` rule, and **Always on ‹host›** for a site you use daily
- [Page actions § page_trustedClick](page-actions.md): the same real-click mechanism, for pages that reject synthetic clicks
