# Hands-free

Hands-free mode replaces the side panel with a microphone on the page. You give instructions by
voice, and the panel's main controls are in a menu that opens when you hover over the mic.

It works only in browsers that can turn speech into text: Chrome, Edge, and other Chromium browsers
with a speech service behind them. Elsewhere there is no detach button, no
`/hands-free`, no **Open hands-free** in the popup, no right-click item and no mic on the page (see
[Which browsers](#which-browsers)).

---

## Turning it on

Any of these turns it on:

- the **detach** button in the side panel's header, just left of minimize
- typing **`/hands-free`** in the composer (the `/` menu offers it once you type `/hand`, and
  `/hand-free` works too)
- **Open hands-free** in the toolbar popup, beside **Open side panel**
- **Open Browsentic (Hands Free)** when you right-click a page; while the mic is on, the item reads
  **Close Browsentic (Hands Free)** and turns it off
- the **Start or stop hands-free** shortcut, **Alt+Shift+H** (**⌥⇧H** on a Mac) unless something
  else already had it; see [Settings → Extension](../configuration.md#the-extension-section)

From the panel, it folds down into a mic and closes; from anywhere else the mic just appears. The
mic sits at the bottom middle of the page and follows you from tab to tab. Opening the side panel
again, from the mic's own menu, the toolbar icon or the right-click **Open Browsentic** item, turns
hands-free off.

Hands-free lasts until you open the panel or the browser closes. A restarted browser comes back with
the panel, never with a microphone already on.

## Talking

Speak. What you say streams in above the mic word by word, and the mic's edge pulses while it hears
you. When you pause, a ring runs once around the mic; when it closes, the instruction is sent.

| Press the mic while… | It… |
| --- | --- |
| the ring is running, or you are mid-sentence | throws away what you said, so you can say it again |
| the agent is working (a turning cyan ring) | stops the run |
| the agent is asking permission (an orange shield) | opens the request, pointing at the mic |
| it is listening | mutes it; press again to listen |
| it needs the microphone | opens the tab where the browser can ask for it |

When a run finishes, its answer streams in above the mic the same way and fades after a moment.

The mic listens for **the tab in front of you**, and only while the browser window is focused. Switch
tabs and it follows; switch to another app and it stops until you come back. It also stops while the
agent is working. The browser lets only one thing listen at a time, so the panel and the mic never
listen together: going hands-free closes the side panel in every window, and opening the panel
anywhere ends hands-free.

## The menu

Hover over the mic for a second and six buttons fan out around it:

| | |
| --- | --- |
| **Attach a file** | Hands a file to this tab's conversation, as dropping it on the panel does; see [Files](files.md) |
| **Live code** | Lets the agent write a script for this page, as the composer's code toggle does; you approve the code before it runs |
| **Focus point** | Opens [A-Eye](a-eye.md): point at an element and it goes with your next instruction |
| **Show what the agent does** | Switches [action cues](action-cues.md) (the ring on each element the agent acts on) on or off, for every tab |
| **Hold to talk** | Switches between listening all the time and listening only while you hold a key; see below |
| **Open the side panel** | Brings the panel back and ends hands-free |

What goes with your next instruction (the element, live code, attached files) shows as chips beside
the mic until you next speak. Each has a **×**.

## Hold to talk

Switch it on from the menu and the mic stops listening on its own. Hold **left Control** (**control**
on a Mac) and speak; let go, and the mic mutes and sends what you said at once, with no countdown.
The key's name shows on the mic while this is on, and the mic grows and turns pink while you hold it.
The setting is remembered.

Left Control is at the far left on Mac and PC keyboards alike, is the same physical key on every
layout (QWERTY, AZERTY, Dvorak), and does nothing on its own in any browser or operating system.

Control is also the shortcut key, so a hold counts only if nothing else joins it. Tap it, press
another key with it (Ctrl + C), or click or scroll while it is down, and the mic does not open; if it
had already opened, what it heard is discarded, not sent. A key press synthesised by a web page is
ignored, so only you can open the mic.

## Moving it

Press and hold the mic until it grows a little, then drag it anywhere. It stays where you drop it on
every tab. Against a side or a corner, the menu opens away from the edge, with its buttons in that
turned order; captions and permission requests move to whichever side has room.

## When the agent needs your OK

The mic turns orange and says what the agent is asking to do. Press it to see the request: the same
**Allow**, **Deny** and **Always on ‹host›** the panel offers, and, when the agent wrote code, the
whole of that code (scrollable if long), since **Allow** runs every line. If the request comes from a
tab you are not looking at, a card appears on the page you are on, or a system notification when the
browser is in the background; clicking it takes you to that tab. Each request is announced once.

## A-Eye never lands on the mic

The mic, like the rail and Browsentic's cards, is marked as Browsentic's own. A-Eye, yours or the
agent's, never outlines or picks it, and a click on the mic while A-Eye is open does nothing. When you
start A-Eye from the mic's menu, the mic moves aside until you have picked.

The agent's pointer passes through the mic as well. A button under it, such as a cookie banner's
**Accept** or a sticky footer, is still one the agent can click or drag to, and an agent's click
there never lands on the mic's own stop.

## Which browsers

Browsentic offers hands-free mode only where speech recognition works:

| | |
| --- | --- |
| **Chrome, Edge** | Offered |
| **Firefox** | Never offered: it has no speech recognition, and no hidden page to listen from |
| **Brave** | Never offered: it ships the speech API with no service behind it, so every attempt fails |
| **Other Chromium browsers** | Offered until their speech service first fails without ever having transcribed a word. From then on the detach button, `/hands-free`, the popup button and the right-click item are gone, and a mic already on the page leaves with a note saying why |

A browser whose speech service has transcribed even once keeps hands-free for good: a later failure
there counts as a dropped connection, not a missing service. A browser that was written off can get
it back: dictate in the panel, and the first word it transcribes brings the detach button back.

## Limits

- **Speech goes to Google** while hands-free is listening, as it does for the panel's dictation; see
  [Limits](../limits.md#speech-goes-to-google).
- **One page at a time can listen.** Chrome runs one speech recognizer at once. If another page
  starts listening, the mic gives it the microphone and says so; press the mic to take it back.
- **Background noise can become an instruction.** Anything that sounds like speech is transcribed.
  The ring before sending is your chance to press and discard it; mute the mic when you are not
  using it.
- **Hold to talk needs the page itself to have keyboard focus.** While you are typing inside a frame
  embedded in the page (some rich editors, Google Docs among them), the key goes to that frame and
  the mic does not hear it. Click the page around it first.
- **No mic where Browsentic is not allowed**: `chrome://` pages, the Chrome Web Store, the new tab
  page. The mic stops listening there, and the toolbar icon is the way back to the panel.

## See also

- [Conversations](conversations.md): typing and dictating in the panel, and minimizing it to the rail
- [Approvals](../approvals.md): what asks first, and why
