# Install

Browsentic is two halves: a browser extension with a side panel, and the local daemon it talks to.
One command installs both. Then [pair them](pair.md) and open the panel.

There is no account, no API key and no cloud service. Browsentic drives your real browser using the
AI agent you already run locally.

---

## Prerequisites

| | Requirement | Check |
| --- | --- | --- |
| **Node** | 20 or newer | `node --version` |
| **Browser** | Chrome, or another Chromium browser (Edge, Brave, Arc) | — |
| **Agent** | One of [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex/cli), [Antigravity](https://antigravity.google/docs/cli/install), [Mistral Vibe](https://github.com/mistralai/mistral-vibe) (beta) or [Grok Build](https://docs.x.ai/build/overview) (beta) on your `PATH`, logged in | `claude --version`, `codex --version`, `agy --version`, `vibe --version`, `grok --version` |

Two things worth knowing before you start:

- **The side panel runs on the agent CLI.** It is what the daemon spawns to reason about an
  instruction, so it is the one thing to have ready before your first run. See
  [Choosing an agent](agents.md). The only setup that needs no CLI is driving the browser solely
  from an [MCP client](mcp-clients.md), which is optional and spawns nothing.
- **Only one of them is needed.** Browsentic checks every one and tells you in the popup which are
  installed. Switching is a click.

---

## Install

On macOS there is an [app](mac-app.md) that does all of this from a window, Node included:

```sh
curl -fsSL https://browsentic.com/install.sh | sh
```

Everywhere else, and on a Mac if you would rather not have the app:

```sh
npx browsentic setup
```

That installs the extension to `~/browsentic/extension/chrome-mv3`, starts the daemon, and prints a
pairing code. The npm package carries the extension build, so nothing is compiled and nothing is
downloaded beyond the one package.

Two steps are left. Both happen inside the browser, so only you can do them.

**1. Load the extension.** Open `chrome://extensions`, turn on **Developer mode** (top right),
press **Load unpacked**, and choose the folder the command printed. On macOS you can press ⇧⌘G in
the folder picker and paste the path.

Pin Browsentic to the toolbar so the popup is one click away.

**2. Paste the pairing code** into the popup and press Connect. It is single use and lives for ten
minutes. `browsentic pair` issues another.

To install the command permanently rather than through `npx`:

```sh
npm i -g browsentic
```

### Updating

```sh
npx browsentic update
```

That replaces the command itself if the registry has something newer, refreshes the installed
extension in place, and restarts the daemon. The install path never changes, so your browser stays
paired. Press ↻ on the Browsentic card at `chrome://extensions` to pick up the new build. Firefox
takes its add-on from the release page instead and updates it on its own — see [Firefox](#firefox).

### Uninstalling

```sh
npx browsentic uninstall
```

One command for the daemon, both directories and the `npx` cache. It prints the plan and asks first.
Remove the card at `chrome://extensions` yourself, ideally before running it. See
[Maintenance](maintenance.md).

### Firefox

Release Firefox installs only add-ons that addons.mozilla.org has signed, so the Firefox build is
not loaded from a folder — it is a signed `.xpi` on every
[GitHub release](https://github.com/imshaikot/browsentic/releases/latest).

```sh
npx browsentic setup --browser firefox
```

That starts the daemon and prints two things: the link to the signed add-on for that same version,
and a pairing code. (The Mac app starts the same daemon; take the add-on from the release page.)

**1. Install the add-on.** Open the link in Firefox and accept both prompts — one to let github.com
install software, one to add Browsentic. Or download `browsentic-<version>-firefox.xpi`, open
`about:addons`, press the gear, choose **Install Add-on From File…** and pick it. Either way
Firefox shows what the add-on asks for and installs it for good — it survives restarts, unlike
anything loaded through `about:debugging`. If the command says the file is not attached yet,
Mozilla is still signing that version; it appears within minutes, occasionally longer.

**2. Paste the pairing code** into the popup and press Connect.

Firefox checks the release page for a newer signed build about once a day and updates itself;
**Check for Updates** under the same gear does it now. There is no `↻` step and nothing to reload.

Nine tools that need Chrome's debugger — the trusted click, the captcha, diagnostics and page-code
tools — do not exist on Firefox, and the agent there is not offered them. [Limits](limits.md) has
the list.

Developer Edition and Nightly can still load `dist/firefox-mv2` from a source checkout with
`xpinstall.signatures.required` set to `false`; that is the loop for working on the Firefox build,
not for using it.

---

## From source

Use this if you are working on Browsentic itself, or want to run an unreleased commit.

```sh
git clone https://github.com/imshaikot/browsentic.git
cd browsentic
node scripts/setup.mjs
```

That runs four steps: extension dependencies, extension build, daemon dependencies, daemon build.
`src/daemon/` is a separate Yarn project with its own lockfile, which is why the root install does not
cover it. Yarn itself is not a prerequisite: the pinned Yarn 4 release ships inside the repository
and the setup script invokes it through Node.

When it finishes you have:

```
dist/chrome-mv3     the unpacked extension
src/daemon/dist     the daemon and MCP server
```

Load `dist/chrome-mv3` directly through **Load unpacked**, or put the CLI on your `PATH` with
`yarn daemon:link` and let `browsentic setup` install from the checkout. Either way Chrome will not
auto-reload the extension after a rebuild, so press ↻ on its card yourself.

---

## Next

**[Pair your browser →](pair.md)** — the extension connects to nothing until you do.
