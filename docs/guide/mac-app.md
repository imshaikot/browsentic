# Browsentic for macOS

Browsentic Bridge, the half of Browsentic that runs on your computer, as a native app. It is the same
command and the same background process as [`npx browsentic@latest setup`](install.md) — the app
carries them inside itself, lays them down in `~/.browsentic`, and then drives them, so nothing here
needs a terminal. It also adds the other half, the extension, to your browsers from their stores.

Requires macOS 14 or newer, on Apple silicon or Intel. On Windows, the [Windows app](windows-app.md) is the same thing.

---

## Install

```sh
curl -fsSL https://browsentic.com/install.sh | sh
```

That downloads the latest release, checks the app’s signature is intact, copies `Browsentic.app` into
Applications, clears the quarantine flag on that copy and opens it. It asks for no password. `BROWSENTIC_VERSION=0.6.2` pins a release, and
`BROWSENTIC_NO_OPEN=1` installs without opening. [Read the script](https://browsentic.com/install.sh)
first if you like — it is sixty lines.

### From the disk image instead

Download `Browsentic-<version>.dmg` from the
[latest release](https://github.com/imshaikot/browsentic/releases/latest) and drag **Browsentic** onto
**Applications**. The build is not notarized yet, and macOS quarantines anything a browser
downloads, so the first open is blocked with “Apple could not verify Browsentic is free of
malware”. Press **Done**, then either open **System Settings → Privacy & Security**, scroll to the
Browsentic line and press **Open Anyway**, or run:

```sh
xattr -dr com.apple.quarantine /Applications/Browsentic.app
```

Right-click ▸ Open no longer gets past this on macOS 15 and newer. The one-line install does that
`xattr` step for you, after verifying the signature.

## The first screen: what your Mac already has

The app opens on five checks and runs them on its own:

| Check | Passes when | If it does not |
| --- | --- | --- |
| **This Mac** | always | — |
| **Node.js runtime** | `node` 20 or newer is on your `PATH` | **Install** downloads the current LTS from nodejs.org into `~/.browsentic/runtime/node`, verified against its published SHA-256. No Homebrew, no password |
| **Browsentic Bridge** | `~/.browsentic/cli` holds the version this app carries | **Install** copies it there, writes the `browsentic` launcher to `~/.browsentic/bin`, and registers it with your browsers so they can start it |
| **A browser** | Chrome, Brave, Edge, Arc, Vivaldi, Opera, Chromium or Firefox is installed | **Get Chrome** opens the download page. Advisory — it does not block you |
| **An AI agent** | One of `claude`, `codex`, `agy`, `vibe`, `grok`, `cursor-agent`, `qwen` or `opencode` is on your `PATH` | **Install Claude Code** runs `npm i -g @anthropic-ai/claude-code`. Advisory |

**Set up everything** installs Node and the Bridge in one click. A browser, the extension and an
agent are yours to choose, so each has a button of its own. When everything required is in place
the app moves on by itself; on later launches that takes about two seconds.

## Adding the extension

**Overview** lists the browsers on your Mac, one row each, with where the extension comes from and
whether it is connected. A browser without it has a button — **Add to Chrome**, **Add to Edge**,
**Get the Firefox add-on** — that opens its store page in that browser and shows a pairing code.
Press the store's button, click Browsentic in the toolbar, enter the code, and the row turns
**Connected**. Edge installs from the Chrome Web Store until its own listing is published; the app
tells you to press **Allow extensions from other stores** first.

**Load it unpacked instead**, under the rows, is for a browser that cannot reach a store or for an
unreleased build. It writes the extension to `~/browsentic/extension/chrome-mv3`, opens
`chrome://extensions` with that path on the clipboard, and shows **Reload needed** on that row when
the folder holds a newer build than the browser has loaded.

> **Why an unpacked extension is not in `~/.browsentic`.** Chrome’s **Load unpacked** dialog is the
> system folder picker, which hides dotfolders, and the browser names an unpacked extension after
> its absolute path. So it lives in `~/browsentic/extension/chrome-mv3`, exactly where the command
> puts it, and everything else goes in `~/.browsentic`.

## The window

The tabs float at the top; ⌘1–⌘8 switch between them.

![Browsentic Bridge running, and one row per browser: Chrome connected from the Chrome Web Store, Brave from an unpacked folder, Edge and Firefox each a button away.](../assets/mac-app/overview.webp "Overview")
![A one-time pairing code a click away, and two paired browsers, each with the store its extension came from.](../assets/mac-app/browsers.webp "Browsers")
![Every agent CLI with its version and a model select, and Codex the one running the side panel.](../assets/mac-app/agents.webp "Agents")
![The three folders skills are read from, a filter, and a card for every skill the agent can route to.](../assets/mac-app/skills.webp "Skills")
![The Bridge log, followed live as the Bridge restarts and the extension reconnects.](../assets/mac-app/logs.webp "Logs")
![The update check, this window’s appearance, the theme every paired browser uses, and the guardrails.](../assets/mac-app/settings.webp "Settings")

| Tab | What you do there |
| --- | --- |
| **Overview** | Turn Browsentic Bridge on and off with the power button, restart it, see its address and version. One row per browser: where its extension comes from, whether it is connected, and a button that adds it from the store. The unpacked folder sits behind **Load it unpacked instead** |
| **Browsers** | Get a [pairing code](pair.md) with a live countdown, see every paired browser and the store its extension came from, unpair one or all |
| **Agents** | See which of the seven agent CLIs are ready, [switch](agents.md) between them, pick a model, install a missing one, or let Browsentic fix what one still needs |
| **Skills** | Every [skill](features/skills.md) the router can see and which folder it came from |
| **Activity** | Your standing [approvals](approvals.md), forgettable per site, and the downloads agents captured |
| **Logs** | `~/.browsentic/daemon.log`, followed live |
| **Settings** | Light, dark or system appearance for this window; whether the Bridge starts with the app; the **Browser theme** and **Guardrails** every paired browser uses, the same rows as the extension's settings page, kept in step both ways; `browsentic` in your terminal; the line that registers Browsentic with an [MCP client](mcp-clients.md); uninstall |
| **About** | Who makes Browsentic, a GitHub star, every version on this computer with a copy button, **Report a bug** (GitHub's issue form with those versions filled in — nothing is sent until you submit it), and links to the guide, this page, [troubleshooting](troubleshooting.md) and the release notes. **Run the checks again** reruns the first-run checks |

There is also a menu bar item with the Bridge’s state and the same on, off and restart.

**Closing the window does not stop anything.** The Bridge is a background process of its own, so
the side panel and any MCP client keep working with the app closed or quit.

## `browsentic` in your terminal

**Settings → “browsentic” in your terminal** links the launcher into a folder that is already on
your `PATH` and already writable — `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`. No shell
profile is edited and no password is asked for. After that every command in the
[CLI reference](../reference/cli.md) works, against the same install the app manages.

If you also have `npm i -g browsentic`, remove it (`npm rm -g browsentic`) so there is one command,
not two that can drift apart.

## Updating

The app asks GitHub and npm for a newer release when it opens and every few hours after. When one
is out, a card appears at the top of **Overview** (and in Settings) with **Update now**: it downloads
the release, checks its signature and that it is the version it claims to be, replaces the app and
reopens it, and the new app replaces the Bridge and restarts it. The extension updates itself from
its store; only an unpacked copy needs ↻ on its card at `chrome://extensions`, and the app says so.
The two don't have to be the same version. **Check for updates** on the same card asks again on the
spot.

A release reaches npm a few minutes before its Mac build is attached; until then the card says so
and offers **Check again** instead. If an update fails nothing is changed, and the card hands you
the install line, which installs the same release from a terminal.

`browsentic update` does not replace an install the app made; it says so and points back here.

## Uninstall

**Settings → Uninstall…** runs [`browsentic uninstall`](../reference/cli.md#uninstall): it unpairs
every browser, stops the Bridge and removes `~/.browsentic` and `~/browsentic`, optionally keeping
your skills. Remove Browsentic from each browser first (right-click its toolbar icon → **Remove**),
and drag the app to the Trash afterwards.

## Building it yourself

```sh
yarn mac:dmg        # → dist/mac/Browsentic.app and dist/mac/Browsentic-<version>.dmg
```

That needs the Swift toolchain — Xcode or the Command Line Tools. The source is a SwiftPM package
in [`src/mac/`](../../src/mac); see [internals/mac-app.md](../internals/mac-app.md).
