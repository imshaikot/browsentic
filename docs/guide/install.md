# Install

Browsentic is two halves: a browser extension and a local daemon. One command installs both. Then
[pair them](pair.md).

There is no account, no API key and no cloud service. Browsentic drives your real browser using the
AI agent you already run locally.

---

## Prerequisites

| | Requirement | Check |
| --- | --- | --- |
| **Node** | 20 or newer | `node --version` |
| **Browser** | Chrome, or another Chromium browser (Edge, Brave, Arc) | — |
| **Agent** | One of [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex/cli) or [Antigravity](https://antigravity.google/docs/cli/install) on your `PATH`, logged in | `claude --version`, `codex --version`, `agy --version` |

Two things worth knowing before you start:

- **An agent CLI is only needed for the side panel.** It is what the daemon spawns to reason about
  an instruction. If you only ever drive the browser from an MCP client, the daemon spawns nothing
  and no agent CLI is required. See [Choosing an agent](agents.md).
- **Only one of the three is needed.** Browsentic checks all three and tells you in the popup which
  are installed. Switching is a click.

---

## Install

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
npx browsentic@latest update
```

That refreshes the installed extension in place and restarts the daemon. The install path never
changes, so your browser stays paired. Press ↻ on the Browsentic card at `chrome://extensions` to
pick up the new build. See [Maintenance](maintenance.md).

### Firefox

Not yet. Release Firefox refuses unsigned extensions, and an add-on loaded through
`about:debugging` is discarded when the browser restarts, so there is nothing durable to install. A
signed build distributed through addons.mozilla.org is the fix and it is not ready.

Developer Edition and Nightly can load `dist/firefox-mv2` from a source checkout with
`xpinstall.signatures.required` set to `false`.

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
