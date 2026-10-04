# Store listings

The extension is published on the Chrome Web Store and submitted to Edge Add-ons; Firefox gets a
signed `.xpi` on every GitHub release instead (see the [Firefox section of the install
guide](../guide/install.md#firefox)). This page is everything a store submission asks for, in the
order the dashboards ask for it, so an update is a matter of pasting.

---

## The listings

| Store | Identity | Address |
| --- | --- | --- |
| Chrome Web Store | `npmocgldfflonjjmdadmdefpnfagnjmp` | [chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp](https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp) — published at 0.8.0 on 4 October 2026 |
| Edge Add-ons | CRX ID `cbkjhkgjcpihokphhdkbahilpcjojpdc` (Partner Center Store ID `0RDCKBB847NN`) | None until Microsoft publishes it; certification of 0.8.0 is under way |
| Firefox | `browsentic@browsentic.com` | `browsentic-<version>-firefox.xpi` on each release, signed on the unlisted channel |

The IDs are fixed for good, and three places depend on them:

- [`src/lib/stores.ts`](../../src/lib/stores.ts) names them, and says where each browser gets the
  extension. Until `EDGE_ADD_ONS.url` is set, Edge is sent to the Chrome Web Store.
- The native messaging host lets both store IDs start Browsentic Bridge whether or not they have
  paired yet ([native-host.ts](../../src/daemon/native-host.ts)).
- The Bridge names each session's source from its origin: a store ID, a `moz-extension://` origin,
  or anything else, which is an unpacked copy.

A store copy keeps the extension's storage, and so its install id and session key, under the
store's ID. Moving from the unpacked folder to a store copy is therefore a new extension, paired
once more.

---

## Submitting an update

1. **Unfreeze the extension.** While a build is in review or freshly published, the extension does
   not change: [`src/extension/store-lock.json`](../../src/extension/store-lock.json) holds a hash
   of every file in it, and `node scripts/extension-lock.ts` fails CI and the release on any
   difference. The pull request that changes the extension runs `yarn build`, then
   `node scripts/extension-lock.ts write`.
2. **Pick a version above every one spent.** The Chrome Web Store has seen 0.7.11 and 0.8.0, and
   Edge Add-ons 0.8.0. A store refuses a number it has already accepted, even for a build it
   rejected.
3. **Check the permissions** against the table below. A new permission needs a line here before it
   goes up, and a permission nothing uses comes out (`activeTab` is the current candidate).
4. **`yarn zip`**, and upload `dist/browsentic-<version>-chrome.zip` to both stores. The Edge zip is
   the same file: only Firefox branches the code, and Edge is told apart at run time.
5. **Keep the window.** A store copy updates on the browser's schedule, so a new extension must
   still work with the Bridge already out there, and a new Bridge with the extension already out
   there. The rule is in [transport.md](transport.md#protocol-version): additive changes bump
   `SOCKET_PROTOCOL_VERSION` and are sent only to a peer that speaks them.

**The Chrome Web Store** can hold an approved build: untick *publish automatically after review*
and press **Publish** within the window it gives. **Edge Add-ons** cannot: passing certification
(up to seven business days) publishes it. Set visibility to **Hidden** to keep it out of search
while the link still installs it.

---

## Listing text

**Category** Developer Tools · **Language** English · **Mature content** No ·
**Website** https://browsentic.com · **Support** https://github.com/imshaikot/browsentic/issues ·
**Privacy policy** https://browsentic.com/privacy/

The summary under the name is the manifest's `description`. The description field:

```text
Browsentic gives your browser a superpower: an AI agent in the side panel that works in the browser you already use, with your tabs, your logins and your sessions. Free, open source, and no API key, no subscription, no account.

Open the side panel, say what you want done, and watch it happen in your own tabs. The thinking is done by the AI agent you already have on your computer, such as Claude Code or Codex, so there is nothing new to sign up for.

WHAT IT DOES
• Reads the page as structure, not pixels, then clicks, types, scrolls, fills in forms and moves between tabs the way you would
• Works in your real, logged-in browser, so it reaches the sites you use without you handing over a password
• Show it a job once and replay it later, or schedule it to run on its own, once or on repeat
• Hands-free mode: talk to it instead of typing
• Writes small tools for sites you use often. You read and approve each one, keep it, and can let it run by itself on every visit
• A Profile for the details forms keep asking for, plus standing instructions for every task, so it fills things in without guessing
• Attach a file and ask about it alongside the page
• Several tasks in several tabs at once

SAFE BY DESIGN
• Connects to nothing until you pair it with a one-time code
• Stops and asks you before anything that counts
• Passwords, keys and tokens are swapped for a sealed placeholder, so the model never sees them
• Sites you block are off-limits to every agent, enforced in the browser
• No Browsentic server and no analytics. Page content goes only to the agent you chose and its model provider

WHAT YOU NEED
Browsentic is two pieces plus the AI you already use: this extension, and Browsentic Bridge on your computer, which starts your agent and keeps everything local.
• On macOS or Windows: install the Browsentic app from browsentic.com, which sets everything up
• On Linux, or without the app: Node.js 20 or newer, then run: npx browsentic@latest setup
• An agent CLI signed in on your computer, such as Claude Code, Codex, or one of the others listed at browsentic.com
Then click Browsentic in the toolbar, enter the pairing code once, and open the side panel.

OPTIONAL: DRIVE IT FROM A TERMINAL
The same paired browser can also be driven from an MCP client such as Claude Code, Cursor or Zed. This is optional. The side panel needs none of it.

OPEN SOURCE
Apache 2.0. Source, docs and issues: https://github.com/imshaikot/browsentic
Website and install guide: https://browsentic.com
Privacy policy: https://browsentic.com/privacy/
```

Edge Add-ons wants the description at 250 characters or more (this is well over), a 300×300 logo,
and reuses the same screenshots. The images — five 1280×800 screenshots, a 440×280 small tile and a
1400×560 marquee — are rendered outside the repository.

---

## Privacy tab

**Single purpose**

> Browsentic is an AI agent in the browser's side panel. The user describes a task in words or by
> voice, and the extension carries it out in their own tabs (reading pages, filling in forms,
> clicking through flows), powered by an AI agent the user already runs on their own computer.

**Permission justifications**

| Permission | Why |
| --- | --- |
| `storage` | Keeps the user's conversations, settings, saved tools and pairing state in the extension's own storage on their computer. |
| `unlimitedStorage` | Recordings of flows the user shows it, attached files and screenshots are kept locally and can exceed the default storage quota. |
| `activeTab` | Gives access to the tab the user is on when they open Browsentic from the toolbar button or the right-click menu. |
| `contextMenus` | Adds one "Open Browsentic" item to the right-click menu, which opens the side panel. |
| `alarms` | Wakes the service worker to reconnect to Browsentic Bridge on the user's computer, to start the user's scheduled tasks on time, and to run timers and page monitors the user asked for. |
| `scripting` | Reads and acts on the pages the user asks about: finding elements, filling in fields, clicking and extracting text. |
| `notifications` | Tells the user when a scheduled task or a timer they set has finished, or when a task needs their approval. |
| `downloads` | Saves a file the user asked the agent to download, and lists what it downloaded so it can hand the file back in the conversation. |
| `nativeMessaging` | Starts Browsentic Bridge, Browsentic's own companion on the user's computer, when it is not running. It talks only to Browsentic's native host. |
| `sidePanel` | The side panel is Browsentic's main interface: the user types or speaks a task there and watches each step as it happens. |
| `debugger` | Used where a page's own scripts would otherwise block an action: trusted clicks and key presses, working inside cross-origin frames, and pages whose Content Security Policy blocks injected scripts. It attaches only to the tab a task is working on, and Chrome shows its standard banner while attached. |
| `offscreen` | Hands-free mode listens for the user's voice through an offscreen document, so it keeps working after the side panel is closed. |
| `userScripts` | Runs a saved tool that the user has reviewed and approved on each visit to its site. It works only after the user turns on Allow User Scripts for Browsentic. |
| Host permission `<all_urls>` | Browsentic works on whatever site the user is on, so it needs to read and act on any page the user asks it to. It does nothing on a page until the user gives it a task there, apart from features the user turns on themselves (a page monitor, a recording, or a saved tool set to run on every visit). |

The `commands` key (keyboard shortcuts) needs no justification.

**Remote code:** *Yes*, with this justification:

> Browsentic never downloads code from a server. It runs JavaScript in a page in only two ways, both
> through APIs Chrome documents for this: (1) through chrome.debugger, the user's own AI agent,
> running on their computer, can write a short script for the page it is working on; the user can
> review it, and by default it runs only after they press Allow. (2) Through chrome.userScripts, a
> script the user has reviewed and saved runs on each visit to its site, only after the user turns
> on Allow User Scripts.

**Data usage:** tick *Personally identifiable information* (the Profile), *Authentication
information* (passwords are sealed, but the extension handles them), *User activity* (recordings)
and *Website content*; leave the rest unticked, and tick all three certifications underneath.

---

## Test instructions

```text
Browsentic needs Browsentic Bridge on the computer and an AI agent CLI; the extension alone shows "offline".
1. On macOS or Windows, install the Browsentic app from https://browsentic.com/install/ . On Linux, install Node.js 20 or newer and run: npx browsentic@latest setup
2. Install and sign in to an agent CLI, such as Claude Code or Codex.
3. The app, or setup, shows a pairing code. Click Browsentic in the toolbar and enter it. (Skip any steps for loading an unpacked copy: the extension is already installed from the store.)
4. Open the side panel on any web page and type a task, for example: Summarise what this page says.
Demo videos of the full flow: https://browsentic.com/demos/
```
