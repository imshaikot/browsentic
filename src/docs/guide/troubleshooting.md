---
layout: layouts/doc.njk
pageKey: docs
title: "Troubleshooting"
seoTitle: "Troubleshooting — Browsentic user guide"
description: "Symptom, cause, fix. For what an error code means, see reference/errors.md. Those three answer most questions. The daemon log also lives at…"
deck: "Symptom, cause, fix. For what an error code means, see reference/errors.md."
docsPath: "guide/troubleshooting.md"
section: "guide"
sectionLabel: "User guide"
sectionOrder: 1
order: 8
isIndex: false
permalink: "/docs/guide/troubleshooting/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/troubleshooting.md"
---
---

## Start here

```sh
browsentic status      # daemon, extension, manifest sync, pairings
browsentic agent       # which agents are installed, which one runs the side panel
browsentic logs        # run starts, routed skills, every tool call and its outcome
```

Those three answer most questions. The daemon log also lives at `~/.browsentic/daemon.log`.

---

## Setup and connection

| Symptom | Cause | Fix |
| --- | --- | --- |
| Popup shows `Expected {op:…}` | Stale service worker after a rebuild | `chrome://extensions` → ↻ reload Browsentic |
| "That pairing code is wrong or expired" | Codes are single-use and last 10 minutes | `browsentic pair` for a fresh one. A failed attempt does not burn the outstanding code |
| "No Browsentic daemon is running" | Nothing on 8765–8767 | `browsentic status`; check `browsentic logs` |
| `browsentic: command not found` | The global npm prefix is not on `PATH` | `npm prefix -g`, then add its `bin` directory |
| `EXTENSION_OFFLINE` | Browser closed, or not paired | Open the browser; `browsentic sessions` to check pairing |
| "Load unpacked" cannot see `~/browsentic` | A Flatpak or Snap browser, sandboxed away from your home directory. Snap Chromium is the Ubuntu default | Grant it: `flatpak override --user --filesystem=~/browsentic com.google.Chrome`. Or install somewhere the sandbox can read: `browsentic setup --dir ~/snap/chromium/common/browsentic-extension` |
| The folder picker does not show `~/browsentic` | It is there; some pickers open elsewhere by default | macOS: press ⇧⌘G and paste the path. Linux: Ctrl+L |
| Updated with `npx`, but the browser still runs the old build | Chrome never auto-reloads an unpacked extension | `browsentic status` names both versions. Press ↻ on the Browsentic card |

## MCP clients

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tools missing from a session | The server was registered mid-session | Restart the client session — MCP servers load at start |
| A tool call is refused as needing approval | External callers cannot answer a prompt, so `confirm` becomes deny | Do it from the side panel, or set `guardrails.unattended: "allow"` — [read this first](/docs/guide/approvals/#callers-with-nobody-to-ask) |
| `page_extractText` with `format: "html"` is denied | `raw-html-read` is denied by default | Use the default text format, or `{"guardrails":{"rules":{"raw-html-read":"allow"}}}` |
| `manifest: DRIFTED` | Extension and CLI built from different registries | `yarn build && yarn daemon:restart`, then reload the extension |

## Agents

| Symptom | Cause | Fix |
| --- | --- | --- |
| `AGENT_MISSING` | The chosen CLI is not on the *daemon's* `PATH` | `browsentic agent` to see all three; set `agents.<name>.bin` to an absolute path in `config.json` |
| `AGENT_NEEDS_PERMISSION` | Antigravity has no rule allowing Browsentic's MCP tools | Press the button in the popup, or `browsentic agent fix antigravity` |
| "does not understand the flags Browsentic uses" | The agent CLI is too old | Update it |
| Antigravity answers but never touches the page | Its permission rule was removed | `browsentic agent` — it reports *needs setup* again |
| Codex fails with "not logged in" | The daemon inherits no session | `codex login`, then retry |

## Pages and tabs

| Symptom | Cause | Fix |
| --- | --- | --- |
| `TAB_UNREACHABLE` on a normal site | The extension needs reloading | ↻ at `chrome://extensions`; ordinary sites otherwise self-heal |
| `TAB_UNREACHABLE` on `chrome://`, the Web Store, the new-tab page | Those pages cannot host a content script | `page_navigate` to an http(s) page — it still works there |
| `TARGET_NOT_FOUND` for something clearly on screen | The page changed since the snapshot, or it is inside a captcha widget's shadow root | Re-snapshot with `page_getPageInfo`; for a captcha use [`page_findCaptcha`](/docs/guide/features/captcha/) |
| `DEBUGGER_UNAVAILABLE` | DevTools is open on that tab | Close DevTools, or use `page_clickElement` instead of `page_trustedClick` |
| `RUN_IN_PROGRESS` | One instruction at a time per tab | Cancel the running one, or use another tab |
| `TAB_IN_USE` | That tab belongs to another Browsentic conversation | Switch to it from the Sessions strip |

## Behaviour that looks wrong but is not

| Symptom | Why |
| --- | --- |
| An action ran but nothing appears in `logs` | It matched the local intent grammar and never reached the daemon. Those carry a ⚡ on the timeline. Explain any single routing decision with `yarn check:intent "<what you said>"` |
| `page_awaitMonitor` returns `settled: false` | The poll window passed while the watch continues. Call again — the monitor is still running in the browser |
| A theme change vanished | Themes do not survive a reload or a navigation. Reapply it |
| A site map was written but nothing changed | Maps stage for review. Open **Skills** in the panel and press **Activate** |
| The panel switched conversations on its own | The panel follows the tab in front, and each tab has its own conversation |
| A recording's typed values came back as `{{placeholders}}` | That is the default. Tick **Save what I type** to keep literal values |

---

## Useful commands

```sh
browsentic status      # daemon, extension and agent state
browsentic agent       # which agents are installed, and which one runs the side panel
browsentic sessions    # which browsers are paired
browsentic revoke      # unpair everything, or one origin
browsentic skills      # every skill in scope, and where it came from
browsentic approvals   # the "always on this site" grants
browsentic tools       # the tool manifest, no browser needed
browsentic logs        # run starts, routed skills, every tool call
browsentic token       # the control token, for MCP clients
browsentic restart     # swap the running daemon for a fresh one
browsentic stop
```

Full descriptions in [reference/cli.md](/docs/reference/cli/).

---

## Still stuck

- [Limits](/docs/guide/limits/) — it may be a boundary rather than a bug
- [reference/errors.md](/docs/reference/errors/) — every code, with what it implies about the next move
- [internals/](/docs/internals/) — how the piece that is failing actually works
