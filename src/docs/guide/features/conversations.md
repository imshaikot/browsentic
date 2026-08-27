---
layout: layouts/doc.njk
pageKey: docs
title: "Conversations"
seoTitle: "Conversations — Browsentic features"
description: "How you talk to Browsentic, and how it keeps track of several things at once. Three ways in: Speech uses the browser's built-in recognition. Nothing is…"
deck: "How you talk to Browsentic, and how it keeps track of several things at once."
docsPath: "guide/features/conversations.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 0
isIndex: false
permalink: "/docs/guide/features/conversations/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/conversations.md"
---
---

## Voice and text

Three ways in:

| | |
| --- | --- |
| **Type** | The composer at the bottom of the side panel |
| **Dictate** | Hands-free in the side panel — press the mic and talk |
| **Press to talk** | In the popup, for when the panel is not open |

Speech uses the browser's built-in recognition. Nothing is bundled or downloaded — which in Chrome
means audio is streamed to Google for transcription. Type instead if that matters to you; see
[Limits](/docs/guide/limits/#speech-goes-to-google).

Replies stream back token by token. Follow-ups continue the same conversation, so **"now click the
second one"** works.

Words are not the only way to say which thing you mean. The composer's lens button opens
[A-Eye](/docs/guide/features/a-eye/): point at an element on the page and it rides along with your next message as its
subject.

---

## One conversation per tab

Each tab gets its own conversation, and several can run at once.

A conversation is **bound to the tab it started in**. It keeps working there while you read
something else, and its actions stay in its own tab instead of following whichever one you are
looking at. That is what makes it safe to start something slow and then go do something else.

**The side panel follows the tab in front.** Switch tabs and the chat switches with it — to that
tab's conversation, or to a fresh empty one if it has none.

### The sessions strip

Above the chat, a row per tab that has a conversation: its live title, a pulsing dot while it is
working, and how many messages it holds. Click a row to jump to that tab and its transcript; press
**×** to end that session. It collapses to a single line when you want the room back.

### Minimizing to the rail

The header's collapse button closes the panel and leaves a small rail floating at the edge of the
page — the same five tabs as icons, and the link's status dot. Click any of them and the panel comes
back on that tab.

A run keeps showing itself while you are minimized: **Chat** carries a pulsing mark, the rail counts
how many runs are live, and its edge picks up the working colour. It stays minimized until you
reopen it.

The rail is drawn into the page, so it cannot appear on pages Browsentic is not allowed into —
`chrome://` pages, the Chrome Web Store and the new tab page. The toolbar icon and the right-click
**Open Browsentic** item always work.

### Knowing something is running when you are elsewhere

While a conversation is working, its tab is marked in two places — a dot on the Browsentic toolbar
icon, and a dot drawn onto the tab's own favicon — so a run you have scrolled away from is still
visible in the tab strip.

### Subtabs

If a conversation opens a tab of its own, that tab joins the same session as a subtab and its work
belongs to the same transcript. A run will not act in a tab another conversation has claimed —
attempting it returns `TAB_IN_USE`.

### Closing things

| | |
| --- | --- |
| **Closing the panel** | Stops nothing. The tab is the anchor. |
| **Closing the tab** | Ends the session: the run is cancelled and the transcript moves to **History**. |
| **Cancelling** | Stops the run in the conversation you are looking at. The others keep going. |

### Limits

| | |
| --- | --- |
| Tab sessions open at once | 8 (`SESSION_LIMIT` beyond that) |
| Running at once | 3, raise with `maxConcurrentRuns`, ceiling 8 (`RUN_LIMIT`) |
| Runs per tab session | 1 (`RUN_IN_PROGRESS`) |

---

## History

Conversations are saved and named automatically. The **History** tab reopens any of them, on any
tab.

---

## The timeline

Every action appears as it happens, with what it targeted and what came back.

| Marking | Meaning |
| --- | --- |
| ⚡ | Ran locally in the browser — an [instant command](/docs/guide/features/instant-commands/), never sent to an agent |
| `external` | Came from an [MCP client](/docs/guide/mcp-clients/), not from this panel |
| An approval card | The run is paused, waiting on you — see [Approvals](/docs/guide/approvals/) |

---

## See also

- [Instant commands](/docs/guide/features/instant-commands/) — why some things answer before you finish reading them
- [Skills](/docs/guide/features/skills/) — what decides how an instruction is handled
- [internals/extension.md § Tab scoping](/docs/internals/extension/#tab-scoping) — how a run stays in its own tab
