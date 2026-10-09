# Android phones

How Browsentic drives Chrome on an Android phone: the Bridge reaches the phone through adb and
relays the Chrome DevTools Protocol, and the extension keeps every bit of tool logic. For what the
user sees, read [guide/features/android.md](../guide/features/android.md) first.

---

## The shape of it

```
Phone        Chrome ── debugging socket (localabstract:chrome_devtools_remote)
               │  adb forward tcp:<free port>
Desktop      Browsentic Bridge ── ws, no Origin header ──► CDP browser target (flattened sessions)
               │  relay frames on the existing paired socket (protocol 23)
             Extension background: phone session + phone backend (a branch in invokeForHarness)
               │  runtime Port "browsentic/phone"
             Phone tab (phone.html): phone frame, screencast canvas, the user's taps and typing
             Side panel on the phone tab: the conversation that drives the phone
```

Nothing is installed on the phone. Chrome on Android always listens on an abstract Unix socket for
DevTools once USB debugging is on; adb forwards a local port to it, and from there it is the same
protocol as desktop Chrome's remote debugging.

## Who owns what

| Part | Owns | Where |
| --- | --- | --- |
| Bridge | adb (finding it, its server, the phone list), readiness, opening Chrome, the forward and the one WebSocket per phone | `src/daemon/android/` |
| Extension | The phone session, the phone tab, every tool's logic, blocked sites, secrets, the tab-session registry | `src/lib/bridge/phone*.ts`, `src/extension/entrypoints/phone/`, `phone-page.ts` |
| Shared | Types, the setup guide, the checklist, the tool list, the page bundle, touch input | `src/lib/phone/` |

**Why the extension keeps the tool logic.** The [blocked-sites list](../guide/features/blocked-sites.md)
lives only in the browser and is never sent to the Bridge, so a Bridge that drove the phone on its
own would drive it past that list. Secrets, frame focus and tab sessions live there too. The Bridge
is a relay, not a second implementation: the control socket's `android` op can open Chrome, but it
has no way to send a DevTools command.

**Why the Bridge holds the socket, not the extension.** Chrome refuses a DevTools WebSocket that
carries an `Origin` header unless it was started with `--remote-allow-origins`, and every
WebSocket an extension page opens carries one. Node's `ws` sends none.

## adb, without spawning adb

`src/daemon/android/adb.ts` finds one adb binary (the configured `android.adb`, then `PATH`,
`ANDROID_HOME`, `ANDROID_SDK_ROOT`, Android Studio's SDK, Homebrew and winget) and runs it only for
`adb version` and, when nothing listens on 5037, `adb start-server`. Everything else goes to adb's
own server over its socket on 127.0.0.1:5037 (`adb-server.ts`): `host:track-devices-l` for the
phone list, `shell:` for the facts, `forward` and `killforward`.

A socket client never kills a server of another version, which running a second adb binary does,
taking Android Studio's connection with it. For the same reason the Bridge never runs
`adb kill-server` or removes forwards it did not make.

`phone-facts.ts` asks for everything in one `shell:` call, each answer under its own marker:
`getprop` for the model and Android version, `wm size` and `wm density`, `dumpsys power` for the
screen, `pm path` and `dumpsys package` for Chrome, `pidof`, and `/proc/net/unix` for the
DevTools socket. Only that socket means Chrome is ready; Android pre-starts the process.

## Readiness

`readiness.ts` turns adb's state and the facts into one `AndroidState`: `enabled`, `ready`, the adb
it found, a device list, and a `problem` with a code, a message, and a `fix` that is only ever
something to copy. `src/lib/phone/checks.ts` (`phoneReport`) turns that into the checklist that
`browsentic android`, the Mac app and the Windows app all show, and `guide.ts` holds the one copy of
the setup steps. The Mac app repeats both by hand and must match.

The Bridge looks for phones only while someone watches: an extension that speaks protocol 23, or an
app showing its Android tab. It pushes every change as `androidInfo`.

## The relay

`relay.ts` holds at most one session per phone. `phoneOpen` makes a fresh forward to
`localabstract:chrome_devtools_remote`, reads `/json/version` for the browser target (never
`/json/protocol`, which crashes Chrome on Android), opens the WebSocket, and lists tabs with
`Target.getTargets`, dropping the phantom target `"1"` that the phone reports beside the real ones.

- **Ownership.** The extension link that opened a session owns it. Another browser asking gets
  `NOT_OWNER`, and events go only to the owner.
- **Commands.** `cdp` frames carry one method each, with a flattened `sessionId`. The answer comes
  back as `cdpResult`. A command that waits inside the page passes `timeoutMs`, at most 180 s.
- **Events.** Everything Chrome sends goes back as `cdpEvent`. Screencast frames are large JPEGs, so
  one that finds the extension's socket more than 4 MB behind is dropped and acknowledged to the
  phone, which keeps the stream going rather than stalling it.
- **Ending.** The phone leaving adb's list, Chrome's socket closing, the Bridge stopping or a
  `phoneClose` ends the session with a `phoneClosed` reason. The forward is removed with it; a
  transport reset drops forwards anyway, so each open makes its own.

The frames are listed in [transport.md § Protocol 23](transport.md#protocol-23-android).

## The phone session and the phone tab

`src/lib/bridge/phone.ts` keeps the session in `storage.session` under `browsentic/phone`: the
serial, the phone tab's id and window, the phone's targets and which one is in front, each target's
tab number, and why it ended. The **Android** toggle (`components/phone-toggle.tsx`) starts and ends
it through the `phoneStart` and `phoneEnd` bridge ops.

The phone tab is `phone.html` (`src/extension/entrypoints/phone/`), an unlisted page. It talks to
the background over the `browsentic/phone` Port, served by `phone-mirror.ts`:

- **The picture** is `Page.startScreencast` on the tab in front, drawn on a canvas inside a phone
  frame the page draws itself. Every frame is acknowledged. It stops while the tab is hidden, and an
  idle page sends no frames, so silence is not a disconnect.
- **Following the phone.** A tab switch on the phone fires no `Target.*` event, so the mirror
  watches page visibility and `Page.screencastVisibilityChanged`, and finds the front tab again.
- **The user's input** goes the same way as the agent's (below): a click becomes a tap, the wheel
  becomes wheel steps, keys become key events, and the bar's back, forward, reload, address and tab
  list become commands.

A conversation started on the phone tab is anchored on the phone's page, never on `phone.html`
(`phone-conversation.ts`), and its `TabSession` carries `phone: { serial }`. Each run's
`RunContext.phone` carries the model, the Android and Chrome versions and the viewport, read when
the message is sent.

## One tap, end to end

The agent calls `page_clickElement { target: { text: "Sign in" } }` in a conversation on the phone
tab.

1. **Agent CLI → MCP server → Bridge.** `browsentic-mcp` (`src/daemon/server.ts`, `tool-host.ts`)
   sends the call over the control socket. `daemon.ts` hands it to `AgentSession.invokeForRun`
   (`agent/service.ts`), where guardrails and approvals run as usual, and a tool off the phone's
   list is refused with `NOT_ON_PHONE` before the browser hears of it.
2. **Bridge → extension.** `link.invoke` (`extension-link.ts`) sends an `invoke` frame;
   `socket.ts` receives it and calls `invokeForHarness` (`src/lib/bridge/invoke.ts`).
3. **The phone branch.** Before any desktop check, `phoneRoute` (`phone-invoke.ts`) sees that the
   run's tab is the phone tab, and `invokeOnPhone` takes over. Host-side tools (the timers) skip the
   branch. `invokeOnPhone` checks `PHONE_TOOLS`, checks the blocked-sites list against the **phone
   page's** address, releases sealed secrets, and calls the backend. Tab tools (`navigate`,
   `openTab`, `switchTab`, `closeTab`) have their own handlers there, over `Target.*` and `Page.*`.
4. **Finding the element.** `pageSideOnPhone` (`phone-backend.ts`) asks the page where the element
   is. The page side runs in an isolated world named `browsentic`, made with
   `Page.createIsolatedWorld` on first use and cached per tab and frame; the bundle `phone-page.js`
   (built from `entrypoints/phone-page.ts` and `src/lib/phone/page-api.ts`) is evaluated in it once.
   It holds the same action code desktop tabs run, under `__browsenticPhone.dispatch`, with no
   extension API in it. A call that finds its world gone, because the page navigated, makes it again
   and retries once. The trusted-click plan scrolls the element into view and returns its centre.
5. **The tap.** `tapOn` subtracts the visual viewport's offset (`Page.getLayoutMetrics`
   `cssVisualViewport`) and refuses a point off screen with `TAP_MISSED`. `src/lib/phone/touch.ts`
   builds `Input.dispatchTouchEvent` `touchStart` and `touchEnd`, and `sendCdp` (`socket.ts`) sends
   each as a `cdp` frame.
6. **Bridge → phone.** `daemon.ts` passes the frame to the relay's `command`, which sends it on the
   phone's WebSocket, through the adb forward, to Chrome. The result comes back the same way as
   `cdpResult`.
7. **The result.** `invokeOnPhone` checks the landing address against blocked sites again for
   tools that navigate, seals any secret in what came back, and the result returns to the agent.
   The phone tab shows the tap as the next screencast frame.

## Touch, keys and scrolling

All of it is in `src/lib/phone/touch.ts`, used by both the backend and the phone tab:

- **Points** are CSS pixels from the visual viewport's corner, never scaled by the pinch zoom: the
  element's client centre minus `visualViewport.offsetLeft/Top`. Chrome accepts points off screen,
  so the backend checks the point is visible first.
- **A click** is a tap; **a drag** is a touch drag that holds before it moves.
- **Scrolling** by an amount is trusted `mouseWheel` steps of 120 px at the middle of the screen,
  adding to 85 % of it. Never `Input.synthesizeScrollGesture`: once a page is pinch-zoomed it strips
  pointer events from every later tap.
- **Typing** focuses the field in the page, then `Input.insertText` in chunks; a newline is Enter.
- **Keys**: Enter is a `keyDown` with `text: '\r'`; others are `rawKeyDown` with a Windows virtual
  key code, without which Backspace and the arrows do nothing.
- **Screenshots** clip in CSS pixels and scale by `1 / dpr`, so one image pixel is one CSS pixel.
- **A `<select>`** opens a native picker CDP cannot see, so its value is set in the page.

## What a phone run is offered

`src/lib/phone/features.ts` holds `PHONE_TOOLS`, an allowlist: a new tool stays off the phone until
someone makes it work there and adds it, with a test. `HOST_SIDE` lists the tools that touch no page
(the timers), which skip the phone branch.

The tool list a browser describes, and so its manifest hash, never changes for the phone. Instead
`AgentSession.offerFor` withholds every tool `phoneOffers` rejects for a run whose context carries
`phone`, and `invokeForRun` refuses a call to one. On the phone tab the side panel hides recordings,
schedules, live tools and saved tools, A-Eye, action cues and hands-free, by the phone tab's id
(`useMirroredPhone` in `phone-client.ts`), because without the `tabs` permission an extension
page's URL is hidden from the panel.

## The prompt

A phone run's prompt opens on the phone rather than "whichever tab is frontmost", and its base skill
is always `src/daemon/skills/phone.md`, whatever the instruction's words would have routed to:
`browser-control.md` teaches desktop tools a phone run is not offered. `phone.md` names only
`PHONE_TOOLS`, and a test holds it to that. A `# Android phone` section carries the device in one
line, so the agent needs no tool call to learn it. See
[agent-runs.md § A run on the phone](agent-runs.md#a-run-on-the-phone).

## Traps

- **A warm VIEW intent opens a new tab every time.** `am start` is only used to cold-start Chrome;
  addresses open over CDP.
- **`Target.createTarget` always opens in front** on Android; `background: true` is ignored.
- **A sleeping phone** stops drawing and throttles the tab. Readiness reports `SCREEN_OFF` from
  `dumpsys power`, and the phone tab asks the user to wake the phone.
- **`MAX_ACTIVE_SESSIONS`** counts the phone tab's conversation like any other.
- **Out-of-process iframes** are untested: the emulator keeps every frame in one process.

## Testing it

The Android emulator is the test phone: an AVD with the Play Store image has Chrome. Fold a
foldable AVD (`adb emu fold`) for the phone layout. `adb reverse tcp:<port> tcp:<port>` lets the
phone load a test server on the computer. Unit tests use recorded adb output under
`src/daemon/android/fixtures/` (the `.handwritten` ones stand in until a real phone records them)
and `src/daemon/test/fake-android.ts`; extension checks run in Chrome for Testing paired
to a scratch Bridge (`BROWSENTIC_HOME` and `BROWSENTIC_PORTS` set, so it never touches a real one).
