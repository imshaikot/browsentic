# Conversations

How you give Browsentic instructions by text or voice, how each tab keeps its own conversation, and
what the side panel shows while runs are going.

---

## Voice and text

Three ways in:

| | |
| --- | --- |
| **Type** | The composer at the bottom of the side panel |
| **Dictate** | Press the mic in the side panel and talk |
| **Hands-free** | The panel put away and a mic on the page; see [Hands-free](hands-free.md) |

Speech uses the browser's built-in recognition. Nothing is bundled or downloaded, which in Chrome
means audio is streamed to Google for transcription. If that matters to you, type instead; see
[Limits](../limits.md#speech-goes-to-google).

The first time you turn the mic on, the panel shows **Allow microphone**. It opens a Browsentic tab
where the browser can ask for access, because a side panel has nowhere to show that prompt. Choose
**Allow** once; the tab closes itself and dictation starts.

Replies stream back token by token. Follow-ups continue the same conversation, so **"now click the
second one"** works.

To say which element you mean without describing it, press the composer's lens button to open
[A-Eye](a-eye.md): point at an element on the page and it goes with your next message as its
subject.

---

## Conversations and tabs

Each tab gets its own conversation, and several can run at once.

A conversation is **bound to its tabs**: the tab it started in, any tabs you add to it, and the tabs
its runs open. It keeps working there while you read something else, and its actions stay in its own
tabs instead of following whichever tab you are looking at, so you can start a slow job and switch to
other work.

**The side panel follows the tab in front.** Switch tabs and the chat switches to that tab's
conversation, or to a new empty one if it has none. Moving between tabs of the same conversation
keeps the panel where it is.

### Adding your own tabs

Related work often sits in several tabs: a Jira issue, the Zendesk ticket about it, the runbook. Put
them in one conversation and the panel stays on it as you move between them.

- **The tabs button** in the composer, beside the paperclip, lists the conversation's tabs and adds
  more; `/tabs` opens it too. Its picker lists this window's other web pages, and the tabs you
  selected in the tab strip (Ctrl or Shift click, ⌘ click on a Mac) come already ticked.
- **Right-click a page** and choose **Add this tab to**, then the conversation. When the tab is part
  of a selection in the tab strip, the whole selection goes. Firefox also offers it when you
  right-click a tab itself. It can be switched off in Settings → Extension.

On a tab with no conversation yet, adding tabs starts one there, so you can gather the tabs before
the first message.

A tab belongs to one conversation at a time. Adding a tab another conversation holds moves it; if
that leaves the other conversation with no tab, it goes to **History** and a note says so. A tab a
running conversation is working in stays where it is.

Once a conversation has more than one tab, the button shows their icons. Open it to jump to one, or
take one out with **×**; the tab stays open. Nothing can be taken out while a run is going.

**What the agent is told.** With more than one tab, each message tells the agent the conversation's
tabs: their ids, titles and sites, and which one it is working in. The tab you send a message from
becomes the one it works in. It moves between them without asking you; switching to any other tab,
or closing one of yours, still asks. A tab on a [blocked site](blocked-sites.md) is never listed.

### The sessions strip

Above the chat, one row per tab that has a conversation: its live title, a pulsing dot while it is
working, and how many messages it holds. Click a row to jump to that tab and its transcript; press
**×** to end that session. The strip collapses to a single line when you want the room back.

### Minimizing to the rail

The header's collapse button closes the panel and leaves a small rail at the edge of the page, with
the same five tabs as icons and the link's status dot. Click any of them and the panel comes back on
that tab.

While the panel is minimized, a run stays visible: **Chat** carries a pulsing mark, the rail counts
how many runs are live, and its edge takes on the working colour. The panel stays minimized until
you reopen it.

The rail is drawn into the page, so it cannot appear on pages Browsentic is not allowed into:
`chrome://` pages, the Chrome Web Store and the new tab page. The toolbar icon, the right-click
**Open Browsentic** item and the **Open or close the side panel** shortcut (**Alt+Shift+B**,
**⌥⇧B** on a Mac, unless something else already had it) always work; while the panel is open, the
item reads **Close Browsentic** and the shortcut closes it.

The rail belongs to the minimized state only. Closing the panel with the browser's own close button
removes the rail from every page; only the header's collapse button leaves one behind.

The header's detach button, beside collapse, puts the panel away differently: instead of the rail,
you get a microphone on the page that you talk to directly. See [Hands-free](hands-free.md).

### Knowing something is running when you are elsewhere

While a conversation is working, its tab is marked in two places, a dot on the Browsentic toolbar
icon and a dot drawn on the tab's own favicon, so a run you have moved away from still shows in the
tab strip.

### Tabs the agent opens

If a run opens a tab of its own, that tab joins the conversation and its work goes into the same
transcript. A run will not act in a tab another conversation has claimed; trying returns
`TAB_IN_USE`.

### Closing things

| | |
| --- | --- |
| **Closing the panel** | Stops nothing. The tab is the anchor. |
| **Closing the tab it started in** | Hands the conversation to another tab you put in it, with a note. With none left, the session ends: the run is cancelled and the transcript moves to **History**. |
| **Closing another of its tabs** | Takes that tab out. The conversation carries on. |
| **Cancelling** | Stops the run in the conversation you are looking at. The others keep going. |

### Limits

| | |
| --- | --- |
| Tab sessions open at once | 8 (`SESSION_LIMIT` beyond that) |
| Running at once | 3, raise with `maxConcurrentRuns`, ceiling 8 (`RUN_LIMIT`) |
| Runs per tab session | 1 (`RUN_IN_PROGRESS`) |

---

## What a conversation carries: `/context`

Type `/context` (or pick **context** from the `/` menu) and a **Session context** card appears in
the transcript: the message mix so far, the attached files and ready recordings that will go with
your next message, the tabs the session spans, which agent holds the conversation, and whether it
can resume where it left off.

The card also shows token counts from the agent CLI's own reporting: roughly how many tokens the
model's context window held after its last reply, and how many it generated on the last run. Claude
Code, Codex, Grok Build, Cursor CLI, Qwen Code and OpenCode report these; Antigravity, Mistral Vibe
and DeepSeek Harness do not, and the card says so.

Browsentic builds the card in the browser without waking an agent, so it also works mid-run. It
describes what this browser holds; the agent's own working memory lives with the agent.

---

## History

Conversations are saved and named automatically. The **History** tab reopens any of them, on any
tab.

---

## The timeline

Every action appears as it happens, with what it targeted and what came back.

| Marking | Meaning |
| --- | --- |
| ⚡ | Ran locally in the browser as an [instant command](instant-commands.md), never sent to an agent |
| `external` | Came from an [MCP client](../mcp-clients.md), not from this panel |
| An approval card | The run is paused, waiting on you; see [Approvals](../approvals.md) |

### The star request

When an agent finishes a turn cleanly, a small **Star us on GitHub** pill can appear above the
composer. **Star** opens the repository in a tab beside the one you are on, and the pill never comes
back. **×** dismisses it, and so does your next instruction. It asks at most once in a conversation
and three times in all: in your first conversation, in the next one, and once more three
conversations later. A stopped, failed or instant-command turn never raises it, and neither does a
run in a tab you are not looking at.

---

## See also

- [Instant commands](instant-commands.md): commands that run in the browser without an agent
- [Skills](skills.md): what decides how an instruction is handled
- [internals/extension.md § Tab scoping](../../internals/extension.md#tab-scoping): how a run stays in its own tab
