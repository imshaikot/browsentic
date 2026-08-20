# Install

Browsentic is two halves — a browser extension and a local daemon. This page builds both and loads
the extension. Then [pair them](pair.md).

There is no account, no API key and no cloud service. Browsentic drives your real browser using the
AI agent you already run locally.

---

## Prerequisites

| | Requirement | Check |
| --- | --- | --- |
| **Node** | 20 or newer | `node --version` |
| **Browser** | Chrome, or another Chromium browser (Edge, Brave, Arc). Firefox has a build target. | — |
| **Agent** | One of [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex/cli) or [Antigravity](https://antigravity.google/docs/cli/install) on your `PATH`, logged in | `claude --version`, `codex --version`, `agy --version` |
| **git** | To clone the repository | `git --version` |

Four things worth knowing before you start:

- **An agent CLI is only needed for the side panel.** It is what the daemon spawns to reason about
  an instruction. If you only ever drive the browser from an MCP client, the daemon spawns nothing
  and no agent CLI is required. See [Choosing an agent](agents.md).
- **Only one of the three is needed.** Browsentic checks all three and tells you in the popup which
  are installed. Switching is a click.
- **Yarn is not a prerequisite.** The pinned Yarn 4 release ships inside the repository and the
  setup script invokes it through Node. No global install, no Corepack.
- **`@browsentic/mcp` is not published to npm.** Install from source; `npx -y @browsentic/mcp`
  will not resolve.

---

## 1. Clone and build

```sh
git clone https://github.com/imshaikot/browsentic.git
cd browsentic
node scripts/setup.mjs
```

That runs four steps: extension dependencies, extension build, daemon dependencies, daemon build.
`mcp/` is a separate Yarn project with its own lockfile, which is why the root install does not
cover it. Once dependencies exist, `yarn setup` re-runs the same thing.

When it finishes you have:

```
dist/chrome-mv3     the unpacked extension
mcp/dist            the daemon and MCP server
```

## 2. Load the extension

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `dist/chrome-mv3`

Pin Browsentic to the toolbar so the popup is one click away.

**Firefox:** `yarn build:firefox`, then load `dist/firefox-mv2` through `about:debugging` →
**This Firefox** → **Load Temporary Add-on**. Firefox is a supported build target, but Chromium is
what Browsentic is developed against.

Installing from source means Chrome will not auto-update the extension, and will not auto-reload it
after a rebuild — press ↻ on the Browsentic card at `chrome://extensions` yourself. See
[Maintenance](maintenance.md).

---

## Next

**[Pair your browser →](pair.md)** — the extension connects to nothing until you do.
