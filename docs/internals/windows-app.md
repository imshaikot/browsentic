# The Windows app

`src/windows/` is a [Tauri 2](https://tauri.app) app: a Rust shell in `src-tauri/`, a React window
in `ui/`, and the `browsentic.exe` launcher in `launcher/`. Like the [macOS app](mac-app.md), it
**installs** the Node half of Browsentic and then **drives** it, screen for screen the same, and
reimplements nothing: the daemon stays the daemon, for the reasons given there.

## Why Tauri and React

The macOS app is SwiftUI, with the extension's palette converted into Swift by hand. On Windows the
window uses the extension's own stack: `ui/app.css` imports
[globals.css](../../src/extension/assets/globals.css), so Ember and Daylight are the same tokens
rather than a copy, and the guardrail rows and the theme picker are the extension's components
([guardrail-policy.tsx](../../src/extension/components/guardrail-policy.tsx),
[theme-picker.tsx](../../src/extension/components/theme-picker.tsx)), so a rule added to the
daemon appears here as soon as it appears in the settings page. Its control frames are typed by
[control.ts](../../src/daemon/control.ts) itself, where the Swift app declares its own.

Tauri renders with WebView2, which Windows 11 ships, so the installer is about 2 MB and carries
no browser engine. The Rust half is only what a webview cannot do.

## Two ways in, by cost

The same split as the macOS app:

| Path | Used for | Where |
| --- | --- | --- |
| **The control socket**: `ws://127.0.0.1:<port>/control`, bearer token from `daemon.json` | `status`, `sessions`, `pair`, `revoke`, `agent` set and grant, `preferences` and `setPreference` | [control.rs](../../src/windows/src-tauri/src/control.rs) |
| **The installed command**: `node %USERPROFILE%\.browsentic\cli\dist\cli.js …` | `start`, `stop`, `restart`, `setup`, `uninstall`, and the `--json` listings | [main.rs](../../src/windows/src-tauri/src/main.rs) `cli` |

The socket is held in Rust because the daemon authenticates `/control` with an `Authorization`
header, and a webview's WebSocket cannot send one. Replies are matched to requests by id, and the
daemon's unprompted `settings-changed` reaches the window as a Tauri event.

The command starts from the home folder with no console window (`CREATE_NO_WINDOW`), and a daemon
it starts inherits that folder. No install folder is ever held open, which lets the updater replace
the app and the payload swap rename `cli`.

[model.ts](../../src/windows/ui/model.ts) is `AppModel.swift` ported: the same phases, the
same six checks and their messages, the same two-second poll.
[backend.ts](../../src/windows/ui/backend.ts) is everything it asks of the machine, so
[mock-backend.ts](../../src/windows/ui/mock-backend.ts) can stand in for it: `yarn win:preview`
runs the window in any browser, and `model.test.ts` drives the real model through it.

## The payload

[scripts/windows-payload.ts](../../scripts/windows-payload.ts) runs before every Tauri build and
stages what the macOS app's `build-app.sh` stages: the npm package's layout (`dist/cli.js`,
`dist/daemon-main.js`, `skills/`, `extension/chrome-mv3/`, `package.json`) under
`src-tauri/resources/payload`, refusing a build whose extension, daemon and package versions
disagree. It also builds the launcher for the target Tauri names, through `cargo-xwin` when the
build is not on Windows.

**Set up everything** then does what the macOS app does, in
[payload.rs](../../src/windows/src-tauri/src/payload.rs):

- the payload is copied into a staging folder and swapped into `%USERPROFILE%\.browsentic\cli`
  whole, with the `.browsentic-app.json` marker that makes `installKind()` answer `app`, so
  `browsentic update` leaves it to the app;
- a running daemon is stopped first, because Windows will not rename a folder a process has open,
  and started again after;
- `browsentic.exe` and `browsentic-mcp.exe` go to `%USERPROFILE%\.browsentic\bin`. Windows will not
  overwrite a running program but will rename one, so a launcher an MCP client still holds is
  renamed aside and swept later.

The payload is "current" only when the version matches **and** the marker is there, the lesson the
macOS app learned from a same-version build installed over a release.

## The launcher

[launcher/src/main.rs](../../src/windows/launcher/src/main.rs) is the `browsentic` command on
Windows. It finds Node (the one the marker records, then the private copy, then `PATH`), runs
`cli.js` with the terminal's input and output, and exits with Node's code. Invoked as
`browsentic-mcp`, with no arguments, it runs `mcp`.

It is a real program rather than a `.cmd` because MCP clients start their server without a shell,
and Node refuses to start a `.cmd` without one. Windows has no `exec`, so Node stays its child: a
job object with `KILL_ON_JOB_CLOSE` ends Node when the launcher is ended, and
`SILENT_BREAKAWAY_OK` lets everything Node starts, the daemon above all, leave the job and outlive
it.

## PATH

**“browsentic” in your terminal** writes `%USERPROFILE%\.browsentic\bin` into the user `PATH` in the
registry (`HKCU\Environment`), as `REG_EXPAND_SZ` so entries like `%USERPROFILE%` keep expanding,
and broadcasts `WM_SETTINGCHANGE` so terminals opened afterwards see it
([path_env.rs](../../src/windows/src-tauri/src/path_env.rs)). Every program the app starts gets the
`PATH` a new terminal would, read from the registry, so an agent installed while the app is open is
found without restarting it.

## Updating and uninstalling

The updater is Tauri's, driven from [update.rs](../../src/windows/src-tauri/src/update.rs). It reads
`latest.json` from the latest GitHub release, which the release workflow writes once both installers
are attached, and installs only a download signed by the key whose public half is in
`tauri.conf.json`; the private half is the `TAURI_SIGNING_PRIVATE_KEY` repository secret.
`BROWSENTIC_UPDATE_URL` points a test build at another feed; the signature check still applies. The
new installer runs in passive mode, and the next launch finds a newer payload than the one installed
and sets it up without a press, as `finishUpdateOnLaunch` does on macOS.

The installer is NSIS, per user, into `%LOCALAPPDATA%\Browsentic`.
[installer-hooks.nsh](../../src/windows/src-tauri/installer-hooks.nsh) runs `Browsentic.exe
--uninstall` before a real uninstall, which stops the daemon and takes `bin` off the `PATH`; an update
also runs the old uninstaller, with `/UPDATE`, and the hook skips it then.

## Build and test

```powershell
yarn win:app              # the extension, the daemon, the payload, then the NSIS installer
yarn win:preview          # the window in a browser, against mock-backend.ts
yarn vitest run --project windows
cd src\windows; cargo test --workspace
```

From macOS, the same installer cross-builds with `cargo-xwin`, LLVM and NSIS (`brew install
rustup llvm makensis`, `cargo install cargo-xwin`, and the `aarch64-pc-windows-msvc` or
`x86_64-pc-windows-msvc` target):

```sh
yarn build && yarn daemon:build
yarn tauri build --runner cargo-xwin --target aarch64-pc-windows-msvc
```

CI's `windows-app` job builds and tests the Rust half on `windows-latest`; the release workflow's
`windows-app` job builds an installer per architecture and `windows-feed` writes `latest.json`.
