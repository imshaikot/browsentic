# Browsentic for macOS

A native app that installs Browsentic and runs it from a window. It is the same command and the
same daemon as [`npx browsentic setup`](install.md) — the app carries them inside itself, lays them
down in `~/.browsentic`, and then drives them, so nothing here needs a terminal.

Requires macOS 14 or newer, on Apple silicon or Intel.

---

## Install

```sh
curl -fsSL https://browsentic.com/install.sh | sh
```

That downloads the latest release, checks the app’s signature is intact, copies `Browsentic.app` into
Applications, clears the quarantine flag on that copy and opens it. It asks for no password. `BROWSENTIC_VERSION=0.6.0` pins a release, and
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

The app opens on six checks and runs them on its own:

| Check | Passes when | If it does not |
| --- | --- | --- |
| **This Mac** | always | — |
| **Node.js runtime** | `node` 20 or newer is on your `PATH` | **Install** downloads the current LTS from nodejs.org into `~/.browsentic/runtime/node`, verified against its published SHA-256. No Homebrew, no password |
| **Browsentic command** | `~/.browsentic/cli` holds the version this app carries | **Install** copies it there and writes the `browsentic` launcher to `~/.browsentic/bin` |
| **Browser extension** | the same version is unpacked at `~/browsentic/extension/chrome-mv3` | **Install** unpacks it |
| **A Chromium browser** | Chrome, Brave, Edge, Arc, Vivaldi, Opera or Chromium is installed | **Get Chrome** opens the download page. Advisory — it does not block you |
| **An AI agent** | `claude`, `codex` or `agy` is on your `PATH` | **Install Claude Code** runs `npm i -g @anthropic-ai/claude-code`. Advisory |

**Set up everything** installs the first three in one click. A browser and an agent are yours to
choose, so each has a button of its own. When everything required is in place the app moves on by
itself; on later launches that takes about two seconds.

> **Why the extension is not in `~/.browsentic`.** Chrome’s **Load unpacked** dialog is the
> system folder picker, which hides dotfolders, and a browser’s pairing is tied to the extension’s
> absolute path. So the extension lives in `~/browsentic/extension/chrome-mv3`, exactly where the
> command puts it, and everything else goes in `~/.browsentic`.

## The window

The tabs float at the top; ⌘1–⌘7 switch between them.

| Tab | What you do there |
| --- | --- |
| **Overview** | Turn the daemon on and off with the power button, restart it, see its address, version and whether the extension is connected and in sync. Copy the extension’s path, or open `chrome://extensions` in your browser with the path already on the clipboard |
| **Browsers** | Get a [pairing code](pair.md) with a live countdown, see every paired browser, unpair one or all |
| **Agents** | See which of Claude Code, Codex and Antigravity are ready, [switch](agents.md) between them, pick a model, install a missing one, or let Browsentic fix what one still needs |
| **Skills** | Every [skill](features/skills.md) the router can see and which folder it came from |
| **Activity** | Your standing [approvals](approvals.md), forgettable per site, and the downloads agents captured |
| **Logs** | `~/.browsentic/daemon.log`, followed live |
| **Settings** | Light, dark or system appearance; whether the daemon starts with the app; `browsentic` in your terminal; the line that registers Browsentic with an [MCP client](mcp-clients.md); uninstall |

There is also a menu bar item with the daemon’s state and the same on, off and restart.

**Closing the window does not stop anything.** The daemon is a background process of its own, so
the side panel and any MCP client keep working with the app closed or quit.

## `browsentic` in your terminal

**Settings → “browsentic” in your terminal** links the launcher into a folder that is already on
your `PATH` and already writable — `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`. No shell
profile is edited and no password is asked for. After that every command in the
[CLI reference](../reference/cli.md) works, against the same install the app manages.

If you also have `npm i -g browsentic`, remove it (`npm rm -g browsentic`) so there is one command,
not two that can drift apart.

## Updating

Settings shows a banner when a newer release is out. Run the install line again — it replaces the
app and opens it: the first screen notices the command and the extension are older than the ones it carries,
and **Set up everything** replaces both and restarts the daemon. Then press ↻ on the Browsentic card
at `chrome://extensions`, which is the one step no installer can do for you.

`browsentic update` does not replace an install the app made; it says so and points back here.

## Uninstall

**Settings → Uninstall…** runs [`browsentic uninstall`](../reference/cli.md#uninstall): it unpairs
every browser, stops the daemon and removes `~/.browsentic` and `~/browsentic`, optionally keeping
your skills. Remove the Browsentic card at `chrome://extensions` first, and drag the app to the
Trash afterwards.

## Building it yourself

```sh
yarn mac:dmg        # → dist/mac/Browsentic.app and dist/mac/Browsentic-<version>.dmg
```

That needs the Swift toolchain — Xcode or the Command Line Tools. The source is a SwiftPM package
in [`src/mac/`](../../src/mac); see [internals/mac-app.md](../internals/mac-app.md).
