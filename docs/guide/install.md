# Install

One line installs Browsentic Bridge on your computer, then walks you through adding the extension
from your browser's store. The two connect by themselves. Browsentic is your browser's superpower,
free and open source, with no API key, no account and no cloud service of its own.

The Mac app, the Windows app or `npx browsentic@latest setup` installs Browsentic Bridge (the part
that runs on your computer), asks which browser you use and opens the extension's store page in it.
Press **Add**, and the extension connects to the Bridge by itself. The side panel runs on an agent
CLI you are signed in to, such as Claude Code or Codex.

The extension is on the
[Chrome Web Store](https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp)
for Chrome, Brave, Arc, Vivaldi and Opera, on
[Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/browsentic/cbkjhkgjcpihokphhdkbahilpcjojpdc)
for Edge, and Firefox gets an [add-on signed by Mozilla](https://browsentic.com/download/firefox).
Setup opens the Chrome Web Store in every Chromium browser, Edge included, and the add-on in Firefox.

---

## What you need

| | Requirement | Check |
| --- | --- | --- |
| **Browser** | Chrome, Edge, Brave, Arc, Vivaldi, Opera or another Chromium browser, or Firefox 140 or newer | |
| **System** | macOS, Windows 10 or 11 ([experimental](limits.md#windows-is-experimental)), or Linux | |
| **Node** | 20 or newer, only for `npx`: the [Mac app](mac-app.md) and the [Windows app](windows-app.md) bring their own | `node --version` |
| **Agent** | One of [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex/cli), [Antigravity](https://antigravity.google/docs/cli/install), [Mistral Vibe](https://github.com/mistralai/mistral-vibe) (beta), [Grok Build](https://docs.x.ai/build/overview) (beta), [Cursor CLI](https://cursor.com/docs/cli/overview) (beta), [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/) (beta), [OpenCode](https://opencode.ai/docs/cli/) (beta) or [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) (beta) on your `PATH`, logged in | `claude --version`, `codex --version`, `agy --version`, `vibe --version`, `grok --version`, `cursor-agent --version`, `qwen --version`, `opencode --version`, `dsh --version` |

Before you start:

- **The side panel needs an agent CLI.** Browsentic Bridge starts it to work on each instruction,
  so have one ready before your first run; see [Choosing an agent](agents.md). Only driving the
  browser solely from an optional [MCP client](mcp-clients.md) needs no CLI, because that path
  starts nothing.
- **One agent CLI is enough.** Browsentic checks for all of them, and the side panel's agent picker
  shows which are installed. Switching is one click.

---

## 1. Install Browsentic

This installs Browsentic Bridge, which starts your agent and keeps everything local, then walks you
through adding the extension.

On macOS, the [app](mac-app.md) does it from a window, Node included:

```sh
curl -fsSL https://browsentic.com/install.sh | sh
```

On Windows, the [Windows app](windows-app.md) does the same. In PowerShell:

```powershell
irm https://browsentic.com/install.ps1 | iex
```

Everywhere else, and on either if you would rather not have an app:

```sh
npx browsentic@latest setup
```

On a terminal, `setup` starts the Bridge, checks your agent, and asks which browser should get the
extension:

```
  Browsentic 0.8.0 — your browser's superpower

  ✓ Browsentic Bridge  running on 127.0.0.1:8765 (pid 4242)
  ✓ Wake-up            Chrome, Edge, Firefox can start the Bridge when it is down
  ✓ Agent              Claude Code · also ready: Codex

  Which browser should get the extension?

     1  Chrome    Chrome Web Store
     2  Edge      Chrome Web Store
     3  Firefox   signed add-on
     4  Another browser: load it unpacked

  › 1
```

It opens that browser's store page in that browser, prints a pairing code, and waits for the
browser to connect. `--browser chrome` (or `edge`, `brave`, `arc`, `vivaldi`, `opera`, `chromium`,
`firefox`) skips the question. With no terminal to ask on, `setup` prints the store links and a code
instead. The [CLI reference](../reference/cli.md) has every flag.

To install the command permanently rather than through `npx`:

```sh
npm i -g browsentic
```

## 2. Add the extension

Setup, or the app's button for that browser, opens Browsentic's store page in it. What to press there:

| Browser | The page it opens | What to press |
| --- | --- | --- |
| Chrome, Brave, Arc, Vivaldi | [Chrome Web Store](https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp) | **Add to Chrome** (in Brave, **Add to Brave**) |
| Edge | [Chrome Web Store](https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp) | **Allow extensions from other stores** in the bar at the top, if Edge shows it, and confirm; then **Add to Chrome**. The [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/browsentic/cbkjhkgjcpihokphhdkbahilpcjojpdc) copy works the same |
| Opera | [Chrome Web Store](https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp) | Opera first offers its **Install Chrome Extensions** helper: add it, then **Add to Opera** |
| Firefox 140 or newer | [The signed add-on](https://browsentic.com/download/firefox) | Accept both prompts: one lets github.com install software, one adds Browsentic. See [Firefox](#firefox) |
| Ungoogled Chromium, a profile that blocks stores, an unreleased build | None: `setup --unpacked` writes a folder | See [Load unpacked](#load-unpacked-advanced) |

Pin Browsentic to the toolbar from the puzzle-piece menu, so the side panel is one click away. It
updates itself from its store from then on.

If you added it from the store before installing the Bridge, the two connect as soon as the Bridge
is in place: the extension's welcome page shows it happen.

## 3. Pair them, once

There is usually nothing to do: the extension pairs with the Bridge by itself, and the browser
keeps the pairing. If you set pairing to ask you first, allow the browser in the app or with
`browsentic approve`.

If the extension asks for a code (an extension from before automatic pairing, a browser the Bridge
cannot register with, or pairing set to `code`), click Browsentic in the toolbar to open the side
panel, press **Set up the link**, then **Pair with a code instead**, enter the code the app or
`setup` shows, and press **Connect**. The code works once and lives for ten minutes;
`browsentic pair`, or **Get a pairing code** in the app, issues another. [Pairing](pair.md) has the
detail.

---

## Updating

| What | How it updates |
| --- | --- |
| The extension from the Chrome Web Store or Edge Add-ons | The browser downloads it when it checks (every few hours), or as soon as the Bridge is newer than the extension; then the side panel says the new version is ready above the prompt; press **Update**. A browser restart installs it too |
| The Firefox add-on | Firefox downloads it about once a day; then the side panel says the new version is ready above the prompt; press **Update**. `about:addons` → the gear → **Check for Updates** checks now |
| Browsentic Bridge, from an app | The app offers each release on its Overview tab; one press updates the app and the Bridge |
| Browsentic Bridge, from `npx` | `npx browsentic@latest update` |
| An unpacked copy | `browsentic update` rewrites the folder in place; press **Update** in the side panel, or ↻ on its card |

The extension and the Bridge do not have to be the same version. A store copy can update before or
after the Bridge does, and they go on working: Browsentic Bridge 0.8 works with the extension from
0.7.14 on. `browsentic update` replaces the command if the registry has something newer and
restarts the Bridge on it; your browser stays paired.

## Uninstalling

```sh
npx browsentic uninstall
```

This removes the Bridge, its directories and the `npx` cache, after printing the plan and asking.
Remove the extension from each browser yourself (right-click its toolbar icon → **Remove**). See
[Maintenance](maintenance.md).

---

## Firefox

Release Firefox installs only add-ons that addons.mozilla.org has signed, so the Firefox build is a
signed `.xpi` on every [GitHub release](https://github.com/imshaikot/browsentic/releases/latest),
and [browsentic.com/download/firefox](https://browsentic.com/download/firefox) always points at the
newest one.

```sh
npx browsentic@latest setup --browser firefox
```

That starts the Bridge, opens the add-on for that same version in Firefox, and prints a pairing
code. The apps' **Get the Firefox add-on** button does the same.

**1. Install the add-on.** Accept both prompts: one lets github.com install software, one adds
Browsentic. Or download `browsentic-<version>-firefox.xpi`, open `about:addons`, press the gear,
choose **Install Add-on From File…** and pick it. Either way it is installed for good: it survives
restarts, unlike anything loaded through `about:debugging`. If `setup` says the file is not attached
yet, Mozilla is still signing that version; it appears within minutes, occasionally longer.

**2. Enter the pairing code** in the side panel (click the status pill to open **Connection**) and
press **Connect**.

Firefox checks for a newer signed build about once a day. When it has one, the side panel says so
above the prompt; press **Update**, or let the next Firefox start install it. There is no ↻ step.

Nine tools that need Chrome's debugger (the trusted click, the captcha, diagnostics and page-code
tools) do not exist on Firefox, and the agent there is not offered them. [Limits](limits.md) has
the list.

Developer Edition and Nightly can still load `dist/firefox-mv2` from a source checkout with
`xpinstall.signatures.required` set to `false`; that is the loop for working on the Firefox build,
not for using it.

## Load unpacked (advanced)

For a browser that cannot reach a store (ungoogled Chromium, a managed profile that blocks it), or to
try a build the stores do not have yet. The npm package carries the extension build, so nothing is
compiled.

```sh
npx browsentic@latest setup --unpacked
```

That writes the extension to `~/browsentic/extension/chrome-mv3` and prints a pairing code. In the
apps, it is **Load it unpacked instead** under the extension rows.

1. Open your browser's extensions page (`chrome://extensions`, `brave://extensions`…) and turn on
   **Developer mode** (top right).
2. Press **Load unpacked** and choose that folder. On macOS, press ⇧⌘G in the folder picker and paste
   the path; on Linux, Ctrl+L. On Windows it is `%USERPROFILE%\browsentic\extension\chrome-mv3`:
   paste it into the picker's address bar.
3. Click Browsentic in the toolbar, enter the code and press **Connect**.

Keep the folder where it is: the browser names an unpacked extension after its path, and the pairing
belongs to that name. An update rewrites it in place, so press ↻ on its card afterwards.

**Switching to the store copy.** Remove the unpacked card first, then add Browsentic from the store
and pair it once. Two copies in one browser both answer, and `browsentic status` flags it.

---

## From source

Use this if you are working on Browsentic itself, or want to run an unreleased commit.

```sh
git clone https://github.com/imshaikot/browsentic.git
cd browsentic
node scripts/setup.mjs
```

That runs four steps: extension dependencies, extension build, Bridge dependencies, Bridge build.
`src/daemon/` is a separate Yarn project with its own lockfile, which is why the root install does not
cover it. Yarn itself is not a prerequisite: the pinned Yarn 4 release ships inside the repository
and the setup script invokes it through Node.

When it finishes you have:

```
dist/chrome-mv3     the unpacked extension
src/daemon/dist     Browsentic Bridge: the Bridge, the CLI and the MCP server
```

Load `dist/chrome-mv3` directly through **Load unpacked**, or put the CLI on your `PATH` with
`yarn daemon:link` and run `browsentic setup --unpacked` from the checkout. Either way the browser will
not reload the extension after a rebuild, so press ↻ on its card yourself.

---

## Next

**[Your first run →](first-run.md)**: a tour of the side panel and a first instruction to try.
