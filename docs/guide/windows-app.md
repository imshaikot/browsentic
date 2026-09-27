# Browsentic for Windows

An app that installs Browsentic and runs it from a window, the Windows counterpart of the
[macOS app](mac-app.md). It is the same command and the same daemon as
[`npx browsentic setup`](install.md): the app carries them inside itself, lays them down in
`%USERPROFILE%\.browsentic`, and then drives them, so nothing here needs a terminal.

Requires Windows 10 or 11, on x64 or ARM64. Windows is still [experimental](limits.md#windows-is-experimental).

---

## Install

In PowerShell:

```powershell
irm https://browsentic.com/install.ps1 | iex
```

That downloads the latest release's installer for your computer's architecture, installs it for
you alone, and opens the app. It asks for no administrator. `$env:BROWSENTIC_VERSION = '0.8.0'` pins a
release, and `$env:BROWSENTIC_NO_OPEN = '1'` installs without opening.
[Read the script](https://browsentic.com/install.ps1) first if you like; it is eighty lines.

### From the installer instead

Download `Browsentic-<version>-x64-setup.exe`, or `-arm64-setup.exe` on an ARM computer, from the
[latest release](https://github.com/imshaikot/browsentic/releases/latest) and run it. The installer
is not code-signed yet, so SmartScreen stops a downloaded copy with “Windows protected your PC”:
press **More info**, then **Run anyway**. The one-line install avoids that, because a file PowerShell
downloads carries no mark for SmartScreen to check.

The app installs to `%LOCALAPPDATA%\Browsentic`, adds itself to the Start menu, and uses the
WebView2 runtime that Windows 11 ships with (Windows 10 downloads it during the install if it is
missing).

## The first screen: what your computer already has

The app opens on six checks and runs them on its own:

| Check | Passes when | If it does not |
| --- | --- | --- |
| **This computer** | always | — |
| **Node.js runtime** | `node` 20 or newer is on your `PATH` | **Install** downloads the current LTS from nodejs.org into `%USERPROFILE%\.browsentic\runtime\node`, verified against its published SHA-256. No administrator |
| **Browsentic command** | `%USERPROFILE%\.browsentic\cli` holds the version this app carries | **Install** copies it there and writes the `browsentic.exe` launcher to `%USERPROFILE%\.browsentic\bin` |
| **Browser extension** | the same version is unpacked at `%USERPROFILE%\browsentic\extension\chrome-mv3` | **Install** unpacks it |
| **A Chromium browser** | Chrome, Edge, Brave, Vivaldi, Opera or Chromium is installed | **Get Chrome** opens the download page. Advisory: it does not block you |
| **An AI agent** | One of `claude`, `codex`, `agy`, `vibe`, `grok`, `cursor-agent`, `qwen` or `opencode` is on your `PATH` | **Install Claude Code** runs `npm install --global @anthropic-ai/claude-code`. Advisory |

**Set up everything** installs the first three in one click. A browser and an agent are yours to
choose, so each has a button of its own. When everything required is in place the app moves on by
itself.

Claude Code on Windows also needs [Git for Windows](https://git-scm.com/downloads/win), which it
runs its shell commands through.

## The window

The tabs float at the top; Ctrl+1 to Ctrl+7 switch between them. Ctrl+Shift+D turns the daemon
on or off, Ctrl+Shift+R restarts it, and Ctrl+Shift+P gets a new pairing code.

| Tab | What you do there |
| --- | --- |
| **Overview** | Turn the daemon on and off with the power button, restart it, see its address, version and whether the extension is connected and in sync. Copy the extension's folder, or open `chrome://extensions` in your browser with the folder already on the clipboard |
| **Browsers** | Get a [pairing code](pair.md) with a live countdown, see every paired browser, unpair one or all |
| **Agents** | See which agent CLIs are ready, [switch](agents.md) between them, pick a model, install a missing one, or let Browsentic fix what one still needs |
| **Skills** | Every [skill](features/skills.md) the router can see and which folder it came from |
| **Activity** | Your standing [approvals](approvals.md), forgettable per site, and the downloads agents captured |
| **Logs** | `%USERPROFILE%\.browsentic\daemon.log`, followed live |
| **Settings** | Light, dark or system appearance for this window; whether the daemon starts with the app; the **Browser theme** and **Guardrails** every paired browser uses, the same rows as the extension's settings page, kept in step both ways; `browsentic` in your terminal; the line that registers Browsentic with an [MCP client](mcp-clients.md); uninstall |

The Browsentic icon in the notification area shows the daemon's state and has the same on, off and
restart, and a left click opens the window.

**Closing the window does not stop anything.** The app stays in the notification area, and the
daemon is a background process of its own, so the side panel and any MCP client keep working with
the app closed or quit.

## Loading the extension

Browsers load an unpacked extension only by hand. **Extensions in Google Chrome** (or Edge, or
Brave) on the Overview tab opens `chrome://extensions` with the extension's folder on the
clipboard. Turn on **Developer mode**, press **Load unpacked**, click the folder picker's address
bar, paste, and press Enter. Then open the Browsentic popup and paste a pairing code.

## `browsentic` in your terminal

**Settings → “browsentic” in your terminal** adds `%USERPROFILE%\.browsentic\bin` to your user
`PATH`. No administrator is asked for, and nothing else in the `PATH` changes. Terminals that were
already open keep the `PATH` they started with, so open a new one. After that every command in the
[CLI reference](../reference/cli.md) works, against the same install the app manages.

`browsentic.exe` is a small program, not a `.cmd` script, so MCP clients start it directly:

```powershell
claude mcp add browsentic -- browsentic mcp
```

If you also have `npm install --global browsentic`, remove it (`npm rm -g browsentic`) so there is
one command, not two that can drift apart. The Settings tab says so when it finds one.

## Updating

The app asks GitHub for a newer release when it opens and every few hours after. When one is out,
a card appears at the top of **Overview** (and in Settings) with **Update now**: it downloads the new
installer, checks it carries a signature from Browsentic's release key, runs it, and reopens the app,
which replaces the command and the extension and restarts the daemon. Then press ↻ on the Browsentic
card at `chrome://extensions`, which is the one step no installer can do for you. **Check for
updates** on the same card asks again on the spot.

If an update fails nothing is changed, and the card hands you the PowerShell line, which installs
the same release.

`browsentic update` does not replace an install the app made; it says so and points back here.

## Uninstall

**Settings → Uninstall…** runs [`browsentic uninstall`](../reference/cli.md#uninstall): it unpairs
every browser, stops the daemon and removes `%USERPROFILE%\.browsentic` and `%USERPROFILE%\browsentic`,
optionally keeping your skills. Remove the Browsentic card at `chrome://extensions` first. Then
uninstall the app itself in **Settings › Apps › Installed apps**.

Uninstalling only the app, from Installed apps, stops the daemon and takes `browsentic` off your
`PATH`, and leaves your pairing, settings and skills where they are, as dragging the macOS app to
the Trash does.

## Building it yourself

```powershell
yarn win:app        # → src\windows\target\release\bundle\nsis\Browsentic_<version>_<arch>-setup.exe
```

That needs Node.js, Yarn and the Rust toolchain. `yarn win:preview` opens the window in your
browser against a stand-in daemon, on any computer. The source is a Tauri app in
[`src/windows/`](../../src/windows); see [internals/windows-app.md](../internals/windows-app.md).
