# Action cues

Watching the agent work: a glowing ring on whatever it is about to touch.

---

## What you see

Every time an agent acts in a tab, the element it acts on lights up with a ring in your theme's
colour, and a small caption names the action and the element — **Click · Sign in**, **Fill ·
Email**, **Type · Message**. The ring appears a moment before the action lands, follows the element
if the page scrolls it into view, and fades shortly after the action is done. A failed action
flashes the warning colour instead.

Actions that have no element — reading the page, going to a new address, running a script — glow
around the edge of the page instead, with the caption at the top: **Read page**, **Go to
example.com**.

It works for every agent, whoever is driving: a run from the side panel or the mic, and an MCP
client such as Claude Code or Cursor working in your browser.

## Switching it on

It is off until you switch it on, in any of three places — they are one setting:

- the **Show what the agent does** button in the side panel's composer row, next to **Schedule**
- the same item in the [hands-free](hands-free.md) mic's menu
- **Settings → Extension → On the page**

## What it never does

- **It never touches the page you are on.** The ring is drawn in a closed layer of its own, the
  page's scripts cannot see into it, and nothing in it takes a click — a click that lands on the
  ring reaches the page underneath. It does not move focus, scroll, or listen to anything the page
  does.
- **It never shows what is typed.** The caption names a field by its label — **Fill · Password** —
  never by its contents, and the agent's input never reaches the page's layer at all: only where
  an action lands does.
- **It stays out of screenshots.** Before the agent takes a screenshot, or the captcha solver
  photographs a challenge, every ring on the tab is taken off first and the page is given a moment
  to repaint, so the agent does not see its own cue. A page too busy to repaint in that moment is
  the one exception.
- **It is never drawn on a [blocked site](blocked-sites.md)** — the action is refused before
  anything reaches the page.

## Where it stops

- An element inside a frame is ringed inside that frame, so a ring near the frame's edge is cut off
  by it.
- `chrome://` pages and the Web Store never show one, since the browser keeps extensions out of
  them. A tab that loaded before the extension did shows none for its first action, until the
  extension has been let in.
- The ring sits above a page's own dialogs and popovers. In a browser without popover support it
  sits under a modal dialog instead.
