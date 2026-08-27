---
layout: layouts/doc.njk
pageKey: docs
title: "Limits"
seoTitle: "Limits — Browsentic user guide"
description: "The honest boundaries. Read this before deciding where Browsentic fits. There is no headless mode. Browsentic drives the browser you are looking at, in your…"
deck: "The honest boundaries. Read this before deciding where Browsentic fits."
docsPath: "guide/limits.md"
section: "guide"
sectionLabel: "User guide"
sectionOrder: 1
order: 7
isIndex: false
permalink: "/docs/guide/limits/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/limits.md"
---
---

## It needs a real browser, open

There is no headless mode. Browsentic drives the browser you are looking at, in your real profile
with your real logins. Close the browser and every tool call returns `EXTENSION_OFFLINE`.

If you want anonymous fetching of a static page, an ordinary HTTP fetch is the right tool and it is
faster.

## Pages that refuse content scripts

`chrome://` pages, the Chrome Web Store and the new-tab page cannot host a content script, so most
tools return `TAB_UNREACHABLE` there. `page_navigate` still works and is the way out.

Ordinary sites self-heal: a tab that loaded before the extension did gets a content script injected
on first contact.

## One browser link, one run at a time per tab

The daemon keeps a single live extension connection — a newer one supersedes the old. Several
browsers can be *paired*, but only one is connected at a time.

Within the side panel, one instruction runs at a time **per tab session**; a second in the same tab
returns `RUN_IN_PROGRESS`. Eight tab sessions may be open, three may run at once (raise with
`maxConcurrentRuns`, ceiling 8).

## Pairing controls which browser, not which process

This is the security boundary worth understanding.

Pairing binds a browser. It does not authenticate local programs: anything running as your user can
read `~/.browsentic/daemon.json` and drive an already-paired browser through the control port.
**Browsentic assumes your user account is the trust boundary.**

## Prompt injection is a real risk

An agent reading a hostile page is susceptible to instructions embedded in that page. No prompt
makes a model immune to this.

Browsentic mitigates in three ways, none of which is a guarantee:

- page text is [fenced](/docs/internals/guardrails/#fencing) — wrapped in a per-daemon random marker
  with a note that its contents are data, never instructions;
- the system prompt re-states that framing around every injected block;
- a run is [scoped](/docs/guide/approvals/#scope-which-sites-a-run-may-reach) to the sites it is about, and
  navigations that would leave, or that carry a large URL payload, are gated.

The design goal is not an agent that cannot be fooled. It is that a successful injection has
nowhere to send what it took and cannot act outside the tab you pointed at. Keep the
[approval gate](/docs/guide/approvals/) on for anything consequential, and be deliberate about running
instructions on sites you do not trust.

## Containment of the spawned CLI varies by agent

The side panel spawns a third-party agent CLI as you, with its own file and shell tools. Browsentic
contains it with whatever levers that CLI offers, and they are not equal:

| Agent | Containment |
| --- | --- |
| Claude Code | A per-run tool allowlist plus an explicit deny list — the strongest of the three |
| Codex | No per-run tool list; the read-only sandbox is the whole containment, so it can still read any file you can |
| Antigravity | No tool list and no sandbox flag; its built-in tools are governed by your own CLI settings |

The environment is sealed for all three — cloud keys, registry tokens and database URLs inherited
from your shell are removed before the spawn, keeping only what that agent needs to authenticate.
Details in [internals/guardrails.md](/docs/internals/guardrails/#spawn-containment).

## MCP clients cannot answer a prompt

Anything the policy would confirm resolves to **deny** for an external MCP client, because there is
nobody to ask. That is a limit in both directions: your client cannot submit a form through
Browsentic unless you waive it with `guardrails.unattended: "allow"`, and if you do waive it,
nothing is asking you first. See [MCP clients](/docs/guide/mcp-clients/).

## Speech goes to Google

Voice input uses Chrome's built-in Web Speech API, which streams audio to Google for transcription.
No model is bundled and nothing is downloaded. If that is not acceptable, type instead — it is one
file to replace the speech engine.

## Recording and mapping limits

**Recordings** run for at most 15 minutes, follow one tab, live in extension storage rather than on
disk, and drop passwords, hidden fields, one-time codes and card numbers unconditionally.

**Site mapping** is read-only, locked to one host and one tab, and capped at 15 pages / 10
screenshots / 10 minutes by default (ceilings 40 / 24 / 30 minutes). It requires the explicit
`@site-mapper` prefix or the Map button — trigger words alone will not start one.

## Screenshots of very tall pages

Full-page capture stitches viewport tiles, capped at 48 tiles and a 16 384 px canvas side. Beyond
that the bottom is cut off and the result reports `truncated: true`, rather than silently returning
a partial image.

## Themes do not survive a reload

`page_applyTheme` changes the live document. A navigation or a reload puts the page back the way it
was. See [Theming](/docs/guide/features/theming/).

## Loopback ports

The daemon binds the first free port of 8765, 8766, 8767. If all three are taken it will not start.

## Unpacked extension

Installing from source means Chrome will not auto-update it, and will not auto-reload it after a
rebuild — press ↻ at `chrome://extensions`. Chrome may also prompt about developer-mode extensions
on each launch.

---

## See also

- [Approvals](/docs/guide/approvals/) — what is gated and why
- [Troubleshooting](/docs/guide/troubleshooting/) — when one of these bites
- [reference/errors.md](/docs/reference/errors/) — every error code
