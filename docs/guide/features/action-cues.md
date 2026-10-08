# Action cues

Action cues draw a ring on the element an agent is about to act on, with a caption naming the
action, so you can follow a run in the tab itself. They are off until you switch them on.

---

## What you see

When an agent acts in a tab, the element it acts on lights up with a ring in your theme's colour,
and a small caption names the action and the element: **Click · Sign in**, **Fill · Email**,
**Type · Message**. The ring appears a moment before the action lands, follows the element if the
page scrolls it into view, and fades shortly after the action is done. A failed action flashes the
warning colour instead.

Actions with no element (reading the page, going to a new address, running a script) glow around
the edge of the page, with the caption at the top: **Read page**, **Go to example.com**.

Cues show for every agent, whoever is driving: a run from the side panel or the mic, or a client
such as Claude Code or Cursor working in your browser through the optional MCP endpoint.

## Switching it on

Three controls switch it on, and they are one setting:

- the **Show what the agent does** button in the side panel's composer row, next to **Schedule**
- the same item in the [hands-free](hands-free.md) mic's menu
- **Settings → Extension → On the page**

## What it never does

- **It never changes the page you are on.** The ring is drawn in a closed layer of its own that the
  page's scripts cannot see into, and nothing in that layer takes a click: a click on the ring
  reaches the page underneath. It does not move focus, scroll, or listen to page events.
- **It never shows what is typed.** The caption names a field by its label (**Fill · Password**),
  never by its contents. The agent's input never reaches the cue layer at all; only the place the
  action lands does.
- **It stays out of screenshots.** Before the agent takes a screenshot, or the captcha solver
  photographs a challenge, every ring on the tab is removed and the page gets a moment to repaint,
  so the agent does not see its own cue. The exception is a page too busy to repaint in that moment.
- **It is never drawn on a [blocked site](blocked-sites.md).** The action is refused before anything
  reaches the page.

## Where it stops

- An element inside a frame is ringed inside that frame, so a ring near the frame's edge is clipped
  by it.
- `chrome://` pages and the Web Store never show one, because the browser keeps extensions out of
  them. A tab that loaded before the extension did shows none for its first action, until the
  extension has been let in.
- The ring sits above a page's own dialogs and popovers. In a browser without popover support it
  sits under a modal dialog.
