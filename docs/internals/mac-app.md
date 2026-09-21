# The macOS app

`src/mac/` is a SwiftPM package with no dependencies and no Xcode project. It builds
`Browsentic.app`, a SwiftUI control panel that **installs** the Node half of Browsentic and then
**drives** it. It holds no intelligence and reimplements nothing: the daemon stays the daemon.

## Why the daemon stays

The daemon is where the extension socket, the handshake, the MCP server, the guardrails and the
agent runners live, all of it in TypeScript shared with the extension through `src/lib/`. A native
rewrite would fork the action registry and the wire protocol for no gain — the daemon idles at a
few megabytes and the expensive thing it does is spawn an agent CLI. What *is* native is everything
the app does continuously: it speaks the daemon’s `/control` WebSocket itself, so a status refresh
is one frame on an open socket rather than a `node` process every two seconds.

## Two ways in, by cost

| Path | Used for | Where |
| --- | --- | --- |
| **The control socket** — `ws://127.0.0.1:<port>/control`, bearer token from `daemon.json` | `status`, `sessions`, `pair`, `revoke`, `agent` set and grant | [ControlClient.swift](../../src/mac/Sources/Browsentic/Core/ControlClient.swift), the same frames as [remote-bridge.ts](../../src/daemon/remote-bridge.ts) |
| **The installed command** — `node ~/.browsentic/cli/dist/cli.js …` | `start`, `stop`, `restart`, `setup`, `uninstall`, and the `--json` listings for `agent`, `skills`, `approvals`, `downloads` | [CLI.swift](../../src/mac/Sources/Browsentic/Core/CLI.swift) |

Anything that reads or writes disk goes through the command, so config overrides (`downloadDir`,
`skillsDir`, `extensionDir`) are resolved in exactly one place. The open control socket is also
what keeps the daemon from idling out while the app is up.

A `ControlRequest` change in [control.ts](../../src/daemon/control.ts) needs the matching change in
`ControlClient.swift` and `Models.swift`; nothing checks that for you.

## The payload

[build-app.sh](../../src/mac/Scripts/build-app.sh) stages `Contents/Resources/payload/` in the npm
package’s layout — `dist/cli.js`, `dist/daemon-main.js`, `skills/`, `extension/chrome-mv3/`,
`package.json` — because `cli.js` resolves `../skills` and `../extension` from where it sits. Like
`stage-extension.mjs` it validates and never builds: a manifest version that disagrees with
`src/daemon/package.json` is fatal.

[Payload.swift](../../src/mac/Sources/Browsentic/Core/Payload.swift) copies that to
`~/.browsentic/cli` with a directory swap and writes `.browsentic-app.json` beside it.
`installKind()` in [npx.ts](../../src/daemon/npx.ts) reads that marker and answers `app`, which
makes `upgradeCli()` step aside: an app install is only ever replaced by a newer app. The
**extension** is still installed by `browsentic setup`, file by file, for the reasons
[install.ts](../../src/daemon/install.ts) gives — and to the same path, for the reasons
[paths.ts](../../src/daemon/paths.ts) gives.

## PATH

A GUI app inherits launchd’s `PATH`, which has neither Homebrew nor `~/.local/bin`. The daemon
spawns the agent by name and inherits its environment from whoever started it, so
[Shell.swift](../../src/mac/Sources/Browsentic/Core/Shell.swift) asks the user’s login shell for
its `PATH` once and starts every child with that. Skip this and a daemon started from the app
reports every agent as `AGENT_MISSING`.

## Build and test

```sh
cd src/mac
swift build && swift test            # swift-testing, no XCTest
ARCHS=arm64 Scripts/build-app.sh     # quick local bundle; the default is a universal binary
```

`build-app.sh` signs with the hardened runtime when `CODESIGN_IDENTITY` names a Developer ID, and
`make-dmg.sh` notarizes and staples when `APPLE_ID`, `APPLE_TEAM_ID` and `APPLE_APP_PASSWORD` are set
too. With none of them the build is ad hoc, which runs where it was built and is blocked by
Gatekeeper anywhere it was downloaded to.

That is why the install path people are pointed at is `curl -fsSL https://browsentic.com/install.sh | sh`:
it verifies the signature and then clears `com.apple.quarantine` on the copy it installed. Clearing it
is not optional: `curl` sets no flag of its own, but a terminal that was itself downloaded passes its
quarantine to everything its children write, and the app then arrives flagged anyway. The script lives on the
`website` branch as `public/install.sh`, resolves the newest release from the `releases/latest`
redirect, verifies the signature, and copies the app into Applications. It depends on the release
asset being named `Browsentic-<version>.dmg`.

The app updates itself along the same path (`Core/Updater.swift`). `UpdateFeed` takes the newer of
GitHub's `releases/latest` tag and npm's `latest` version, then asks with a `HEAD` whether that
release's DMG exists yet, because the `mac` job attaches it after the npm publish. `AppUpdater`
downloads the image, mounts it, verifies the signature, refuses a bundle whose identifier or version
is not the one offered, and copies it beside the running bundle as `.Browsentic-<version>.app`. A
running app cannot replace itself, so a detached `sh` waits for the process to exit, renames the old
bundle aside, renames the new one in, puts the old one back if that fails, and reopens it. A
translocated copy is not replaced where it runs; the new app goes to Applications instead. The
`finishUpdateOnLaunch` default tells the next launch to replace the command and the extension
without waiting for **Set up everything**. It too depends on the asset name.

CI builds and tests it on `macos-15`; the release workflow’s `mac` job attaches the DMG to the
GitHub release after the npm publish. Colours in
[Theme.swift](../../src/mac/Sources/Browsentic/Theme/Theme.swift) are Ember and Daylight from
`globals.css`, converted from oklch — re-derive them when the extension’s palette changes.
