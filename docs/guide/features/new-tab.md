# New tab

Browsentic Home is the page a new tab opens on: a composer for a task, the sites you visit most, and
your recent conversations. It is on until you switch it off.

---

## What it shows

- **The composer**, the same one the side panel has: type a task, or `/` for skills and commands,
  attach a file, or press the mic to dictate. The chip beside the send button names the agent CLI
  and model the task goes to; press it to pick another.
- **Suggestions** under an empty composer: tasks on the sites you visit most, such as listing the
  pull requests waiting on your GitHub review. Pressing one puts it in the composer to edit. Nothing
  is sent until you send it.
- **Frequent sites**: up to eight, as the browser ranks them. Hover one and press **×** to hide it.
- **Recent conversations**: runs going on in other tabs, with **Watch**, then your last four
  conversations. **All conversations** opens the side panel's History.
- **The header**: the connection pill (pairing and the agent picker), a button that opens the side
  panel, and **Customize**, which holds the theme, the frequent sites switch, the switch for Home
  itself and a link to every setting.

## Sending a task

Sending from Home opens the side panel in the same key press or click, with the conversation in it.
When the agent takes the tab to a site, the site replaces Home and the side panel carries on with the
same conversation, because a conversation belongs to its tab rather than to the page in it.

Until then, Home shows the request and where it stands: the step the agent is on, an approval it is
waiting for (with **Allow** and **Deny**), or the reply. A question that needs no site is answered
on Home and in the side panel alike.

Instant commands work here too. **go to github.com** opens the site straight away, with no agent.

A recent conversation picks up where it was. One still open in another tab switches you to that tab;
one from history continues in this tab, which goes to the page the conversation was on.

## Switching it off

Turn off **Open Browsentic Home on new tabs** under **Settings → Extension → New tab**, or
**Browsentic Home** in the page's **Customize** menu. The same places switch the frequent sites off,
and bring back the sites you hid.

A browser takes its new tab page from an extension's manifest, so Browsentic cannot give the page
back while it is installed. With Home off, it hands each new tab on instead:

- **Chrome** shows its own new tab page, at `chrome://new-tab-page/`.
- **Edge, Brave, Firefox** and other browsers keep their own page out of an extension's reach, so
  they show a plain page of your frequent sites, with a link to turn Home back on.

### Chrome's "Change back to Google?" question

The first time Chrome shows Browsentic Home, on Windows, Mac and ChromeOS, it asks whether to keep
the new tab page. **Keep it** keeps Browsentic and Home. **Change back to Google** switches off all
of Browsentic, the side panel included.

To keep Browsentic and get Chrome's own new tab page back, choose **Keep it**, then switch Home off
as above. If Browsentic was switched off already, turn it back on at `chrome://extensions`.

Firefox shows a notice of its own the first time. Keep the change there too; with Home switched
off, Firefox shows the plain page of frequent sites.

## Where it stops

- **A side panel that is already open stays open on Home.** Chrome can hide a side panel on one tab
  only when the panel belongs to that tab, and Browsentic's follows you from tab to tab.
- **The keyboard starts in the address bar**, as on any new tab page. Click the composer, or click
  anywhere on the page and start typing.
- **A message sent by voice**, after a pause rather than a key press, cannot open the side panel. Home
  shows the run, and **Open the side panel** brings the panel up.
- **The mic never starts on its own here**, even when it was left on in the side panel.
- **Firefox** asks before Browsentic reads your most visited sites, the first time you press **Show
  frequent sites**.
- **Incognito and private windows** keep the browser's own new tab page.
- **A Chromium browser with no side panel** has the toolbar button's launcher follow the run
  instead.
