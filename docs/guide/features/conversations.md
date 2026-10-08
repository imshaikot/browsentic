# Conversations

How you give Browsentic instructions by text or voice, how each tab keeps its own conversation, and
what the side panel shows while runs are going.

---

## Voice and text

Four ways in:

| | |
| --- | --- |
| **Type** | The composer at the bottom of the side panel |
| **Dictate** | Press the mic in the side panel and talk |
| **Press to talk** | In the popup, when the panel is not open |
| **Hands-free** | The panel put away and a mic on the page; see [Hands-free](hands-free.md) |

Speech uses the browser's built-in recognition. Nothing is bundled or downloaded, which in Chrome
means audio is streamed to Google for transcription. If that matters to you, type instead; see
[Limits](../limits.md#speech-goes-to-google).

The first time you turn the mic on, the panel shows **Allow microphone**. It opens a Browsentic tab
where the browser can ask for access, because a side panel and a popup have nowhere to show that
prompt. Choose **Allow** once; the tab closes itself and dictation starts.

Replies stream back token by token. Follow-ups continue the same conversation, so **"now click the
second one"** works.

To say which element you mean without describing it, press the composer's lens button to open
[A-Eye](a-eye.md): point at an element on the page and it goes with your next message as its
subject.

---

## One conversation per tab

Each tab gets its own conversation, and several can run at once.

A conversation is **bound to the tab it started in**. It keeps working there while you read something
else, and its actions stay in that tab instead of following whichever tab you are looking at, so you
can start a slow job and switch to other work.

**The side panel follows the tab in front.** Switch tabs and the chat switches to that tab's
conversation, or to a new empty one if it has none.

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

### Subtabs

If a conversation opens a tab of its own, that tab joins the session as a subtab and its work goes
into the same transcript. A run will not act in a tab another conversation has claimed; trying
returns `TAB_IN_USE`.

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

## What a conversation carries: `/context`

Type `/context` (or pick **context** from the `/` menu) and a **Session context** card appears in
the transcript: the message mix so far, the attached files and ready recordings that will go with
your next message, the tabs the session spans, which agent holds the conversation, and whether it
can resume where it left off.

The card also shows token counts from the agent CLI's own reporting: roughly how many tokens the
model's context window held after its last reply, and how many it generated on the last run. Claude
Code, Codex, Grok Build, Cursor CLI, Qwen Code and OpenCode report these; Antigravity and Mistral
Vibe do not, and the card says so.

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
back. **×** dismisses it for that conversation; it asks again in the next one, and after a second
dismissal it waits two conversations, then three after every dismissal from then on. A stopped,
failed or instant-command turn never raises it, and neither does a run in a tab you are not looking
at.

---

## See also

- [Instant commands](instant-commands.md): commands that run in the browser without an agent
- [Skills](skills.md): what decides how an instruction is handled
- [internals/extension.md § Tab scoping](../../internals/extension.md#tab-scoping): how a run stays in its own tab
