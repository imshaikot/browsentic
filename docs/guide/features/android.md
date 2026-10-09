# Android phone

Browsentic can drive Chrome on your Android phone from your desktop browser. Plug the phone in,
switch on **Android** in the side panel, and a tab opens showing the phone's Chrome live inside a
phone frame. A conversation in that tab works on the phone: the same requests, with real taps and
swipes on the phone instead of mouse clicks. Nothing is installed on the phone.

---

## What you need

- A Chromium browser (Chrome, Edge, Brave, Arc and the like) with the Browsentic extension, paired
  to Browsentic Bridge. Firefox has no Android switch.
- **adb**, Android's debugging tool, from Google's
  [platform-tools](https://developer.android.com/tools/releases/platform-tools). The Bridge looks
  for it on your `PATH`, under `ANDROID_HOME` or `ANDROID_SDK_ROOT`, in Android Studio's SDK, where
  Homebrew puts it, and on Windows where winget unpacks it. If it is somewhere else, name it in
  [`config.json`](../configuration.md#android).
- An Android phone with Google Chrome, connected by USB, or over Wi-Fi once it has been paired with
  adb.

`browsentic android`, or the **Android** tab in the [Mac](../mac-app.md) and
[Windows](../windows-app.md) apps, checks each of these and says what is missing.

## Setting up a phone

Once per phone:

1. **Turn on Developer options.** On the phone, open Settings, then About phone, and tap Build
   number seven times.
2. **Turn on USB debugging.** Open Settings, then System, then Developer options, and turn on USB
   debugging.
3. **Connect the phone** to the computer with a USB cable. When the phone asks, tick "Always allow
   from this computer" and tap Allow.
4. **Or connect over Wi-Fi** (Android 11 or later). In Developer options, turn on Wireless
   debugging and tap Pair device with pairing code. On the computer, run `adb pair <ip:port> <code>`,
   then `adb connect <ip:port>`.
5. **Open Chrome on the phone.** Browsentic drives the Chrome app, so it has to be open.
   `browsentic android open` opens it for you.

After that, plug the phone in and open Chrome.

On Windows, many phones also need a USB driver from their maker, or Google's, before adb can see
them. Android's [OEM USB drivers](https://developer.android.com/studio/run/oem-usb) page lists them.

## Using it

The **Android** switch (a phone icon) appears in the side panel's header once the Bridge sees a
phone. Switch it on and a **phone tab** opens beside the tab you were on. It shows the page in
front on the phone, kept up to date as it changes.

- **Talk to it** in the side panel while the phone tab is in front, exactly as you would for a
  desktop tab. The conversation belongs to the phone tab, and the agent's actions land on the phone.
- **Use it yourself.** Click the picture to tap the phone, scroll on it to scroll, and type while it
  has focus to type on the phone. The bar above has back, forward, reload, the page's address (type
  an address or a search to go there) and the phone's tabs.
- **It follows the phone.** Switch tabs on the phone itself and the picture follows.
- **You can see when the agent is at work.** **Agent working** shows at the top of the phone frame
  while a run is going. The phone stays yours to use meanwhile.
- **Switch it off**, or close the phone tab, to stop. Unplugging the phone or closing Chrome on it
  ends the session too, and the phone tab says why, with a button to reconnect.

The picture pauses while the phone tab is hidden, and while the phone's screen is off, because
Chrome stops drawing then. The phone tab asks you to wake the phone.

## What works on the phone

Reading and acting on a page work the same way: page info and text, waiting for an element,
clicking, filling and typing, keys, choosing an option, selecting text, submitting forms,
scrolling, dragging, screenshots, frames, searching a site, theming and the contrast audit, the
phone's tabs, and timers. The differences:

| On a desktop tab | On the phone |
| --- | --- |
| A click is a script event, or a mouse click through Chrome's debugger | Every click is a real tap |
| Hover opens menus | There is no hover; menus open on a tap |
| Scrolling jumps | Scrolling is a real scroll, so content that loads as you scroll does load |
| Typing is set or simulated in the page | Typing is real keyboard input to the phone |
| A screenshot is of the desktop tab | A screenshot is of the phone's screen, at the page's size |
| Tabs are your browser window's tabs | Tabs are the phone's Chrome tabs |

[Blocked sites](blocked-sites.md) are checked against the phone's own address, and
[approvals](../approvals.md) work as they do on a desktop tab.

**[A-Eye](a-eye.md)** works on the phone tab too. Press its button in the side panel, and when the
lens shows on the phone, click the element on the phone tab's picture: that tap picks it rather
than pressing it, and the pick carries a photograph of the element from the phone. When the agent
asks you to point at something, it works the same way.

**Live tools** work there as well. With the Live tool switch on, the agent can write code for the
phone's page; you approve it before it runs, as on a desktop tab. You can keep the result as a
saved tool and run it with `/` on the phone tab. A saved tool can't run on every visit on the
phone, because nothing of Browsentic is installed there.

## What is off on the phone

While the phone tab is in front, the side panel hides what only works in a desktop tab:
[recordings](recordings.md), [scheduling](scheduling.md), [action cues](action-cues.md) and
[hands-free](hands-free.md). Voice in the panel, attaching a file and attaching the page's context
still work. They all come back when you switch to a desktop tab.

The agent is offered only the tools that work on the phone. Hovering, captchas, downloads,
uploading a file to a page, a site's own tools, monitors and diagnostics stay on the
desktop. If you ask for one of those, the agent says it is not available on the phone.

## Privacy and safety

adb is a powerful connection: a computer that the phone allows over USB debugging can install
apps, read files and control the phone. Browsentic uses it narrowly:

- it reads the phone's model, Android and Chrome versions, screen size and whether the screen is
  on;
- it opens Chrome when you ask it to;
- it forwards one local port to Chrome's own debugging socket, and drives Chrome through that.

It installs nothing on the phone and touches no other app. The connection stays on your computer,
between the Bridge and the phone. Switching Android off, closing the phone tab or unplugging the
phone stops it.

Chrome on the phone holds your real sessions and logins, just like your desktop browser. The same
[approvals](../approvals.md) and [blocked sites](blocked-sites.md) protect it.

If you never want the Bridge to use adb at all, set `"android": { "enabled": false }` in
[`config.json`](../configuration.md#android).

## Limits

- One phone at a time.
- Google Chrome on the phone: not Chrome Beta, Dev or Canary, and not other browsers.
- The phone's screen has to be on and unlocked while the agent works.
- A `<select>` opens the phone's own picker, which Browsentic cannot see. The agent sets the
  value instead.
- New tabs always open in front on the phone, because Chrome on Android does that.

More in [Limits](../limits.md#android-phones). If a phone will not connect, see
[Troubleshooting](../troubleshooting.md#android-phones).
