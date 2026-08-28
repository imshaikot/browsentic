---
layout: layouts/doc.njk
pageKey: docs
title: "User guide"
seoTitle: "User guide — Browsentic user guide"
description: "Everything you need to run Browsentic on your own machine and your own browser. Three short steps, about five minutes in total. There is no account, no API…"
deck: "Everything you need to run Browsentic on your own machine and your own browser."
docsPath: "guide/README.md"
section: "guide"
sectionLabel: "User guide"
sectionOrder: 1
order: -1
isIndex: true
permalink: "/docs/guide/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/README.md"
---
## Setting up

Three short steps, about five minutes in total. There is no account, no API key and no cloud
service.

1. **[Install](/docs/guide/install/)** — clone, build, load the extension
2. **[Pair](/docs/guide/pair/)** — put `browsentic` on your `PATH` and connect your browser to it
3. **[First run](/docs/guide/first-run/)** — a tour of the side panel, and your first instruction

## Using it

**[Features](/docs/guide/features/)** — one page per capability:

| | |
| --- | --- |
| [Conversations](/docs/guide/features/conversations/) | Voice, text, one conversation per tab, history |
| [Instant commands](/docs/guide/features/instant-commands/) | The things that run in milliseconds without an agent |
| [Page actions](/docs/guide/features/page-actions/) | What it can actually do to a page |
| [Screenshots](/docs/guide/features/screenshots/) | Capturing the viewport, the full page, or one element |
| [Theming](/docs/guide/features/theming/) | Dark mode on any site, and a real contrast audit |
| [Captchas](/docs/guide/features/captcha/) | What it will and will not do at a "verify you are human" block |
| [Monitoring](/docs/guide/features/monitoring/) | Watching a long job in the background |
| [Site maps](/docs/guide/features/site-maps/) | Teaching it a site once |
| [Recordings](/docs/guide/features/recordings/) | Showing it a task once, repeating it later |
| [Files](/docs/guide/features/files/) | Attaching a file and uploading it to a page |
| [Skills](/docs/guide/features/skills/) | How instructions get routed, and how to write your own |

## Configuring

| | |
| --- | --- |
| [Choosing an agent](/docs/guide/agents/) | Claude Code, Codex or Antigravity — switching, and what each needs |
| [MCP clients](/docs/guide/mcp-clients/) | Registering Browsentic with Claude Code, Cursor, Zed, Codex, Gemini CLI |
| [Configuration](/docs/guide/configuration/) | Every key in `~/.browsentic/config.json` |
| [Approvals](/docs/guide/approvals/) | The gate — what asks first, and how to tune it |

## When something is wrong

| | |
| --- | --- |
| [Limits](/docs/guide/limits/) | The honest boundaries. Read this before relying on it for anything |
| [Troubleshooting](/docs/guide/troubleshooting/) | Symptom, cause, fix |
| [Maintenance](/docs/guide/maintenance/) | Updating, and removing it cleanly |

---

Want to know how it works underneath? [Internals](/docs/internals/).
