---
layout: layouts/doc.njk
pageKey: docs
title: "Files"
seoTitle: "Files — Browsentic features"
description: "Putting a file you have into a file input on a page. Attach a file in the side panel. Browsentic reads it once, at attach time, and keeps notes about what it…"
deck: "Putting a file you have into a file input on a page."
docsPath: "guide/features/files.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 10
isIndex: false
permalink: "/docs/guide/features/files/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/files.md"
---
---

## How it works

Attach a file in the side panel. Browsentic reads it **once, at attach time**, and keeps notes about
what it is.

From then on the agent sees those notes — never your filesystem — plus two tools:

| | |
| --- | --- |
| `page_listFiles` | Re-read the list, with each file's summary |
| `page_attachFile` | Put one into an `<input type="file">` on the page |

So the agent knows what it is uploading without being able to open anything you did not hand it.

---

## Uploading is gated

`page_attachFile` is a `confirm` by default under the `file-upload` rule: putting a file into a page
hands it to whoever runs that site.

For an [MCP client](/docs/guide/mcp-clients/), which cannot answer a prompt, it is refused outright.

---

## See also

- [Approvals](/docs/guide/approvals/) — the `file-upload` rule
- [reference/tools.md § Files](/docs/reference/tools/#files) — parameters
