# First run

A tour of the side panel, three instructions to try first, and what to check if the agent does not
answer. It assumes you have [installed](install.md) and [paired](pair.md).

---

## Open the side panel

Click the Browsentic toolbar icon and press **Open side panel**, or open it from Chrome's side
panel menu. The popup is for setup (pairing, picking an agent, press-to-talk); the side panel is
where you work.

## The panel, top to bottom

| | |
| --- | --- |
| **Status pill** | Connection state. Click it to reopen the pairing form or switch agents without going back to the popup. |
| **Sessions strip** | One row per tab that has a conversation: its live title, a pulsing dot while it is working, how many messages it holds. Collapses to a single line. See [Conversations](features/conversations.md). |
| **Chat · History · Skills · Recordings · Schedules** | The five sections. Chat is where you talk; the others are covered in [Features](features/). |
| **Timeline** | Every action as it happens, with what it targeted and what came back. |
| **Composer** | Type, or press the mic to dictate. |

## Your first instruction

Open any ordinary website (not a `chrome://` page, which cannot host a content script) and try:

```
what's on this page?
```

The agent calls `page_getPageInfo`, then answers. That round trip shows all four pieces working:
panel → Browsentic Bridge → agent CLI → browser.

Then try something that acts:

```
scroll to the bottom
```

That one carries a ⚡ and returns at once: it matched the local command grammar and ran in the
browser, with no agent involved. See [Instant commands](features/instant-commands.md).

Then something multi-step:

```
find the search box, type "wireless headphones" and show me what comes back
```

Follow-ups continue the same conversation, so **"now click the second one"** works.

## What to expect the first time something is consequential

Submitting a form pauses the run and asks you, with **Allow**, **Deny** and **Always on ‹host›**.
The last grants that one action on that one site and stops asking.

Denying is final: the agent is told to report it and stop, not to find another route to the same
effect. [Approvals](approvals.md) covers the whole gate.

## If it does not answer

Check in this order:

1. `browsentic status`: is your browser `connected`?
2. `browsentic agent`: is the agent CLI installed and ready?
3. `browsentic logs`: run starts, routed skills, every tool call

[Troubleshooting](troubleshooting.md) maps symptoms to fixes.

---

## Where to go next

- **[Features](features/)**: one page per capability
- **[Choosing an agent](agents.md)**: to run one of the other supported agent CLIs
- **[Configuration](configuration.md)**: `~/.browsentic/config.json`
- **[Limits](limits.md)**: where Browsentic stops, worth reading early
